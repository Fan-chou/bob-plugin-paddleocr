// ============================================================
// bob-plugin-paddleocr — main.js
// 基于本地 Ollama (PaddleOCR-VL) 的 Bob OCR 插件
//
// 工作模式：
//   1. 两阶段 (Spotting + OCR)：先获取位置信息，再获取文本
//   2. 单阶段 (OCR only)：直接获取文本（无位置信息）
//
// API: OpenAI 兼容 /v1/chat/completions，图片用 data: URL
// ============================================================

var DEFAULT_API_URL = "http://localhost:11434";
var DEFAULT_MODEL = "paddleocr-vl";
var DEFAULT_TIMEOUT = 60;

// ---- 坐标网格归一化系数 ----
var LOC_GRID_SIZE = 1000;

// ============================================================
// 1. 必须实现：支持语言列表
// ============================================================

var SUPPORTED_LANGUAGES = [
  "auto", "zh-Hans", "zh-Hant", "en", "ja", "ko",
  "fr", "de", "es", "it", "pt", "ru", "ar", "nl",
  "pl", "th", "vi", "tr"
];

function supportLanguages() {
  return SUPPORTED_LANGUAGES;
}

// ============================================================
// 2. 可选：声明支持 bounding box
// ============================================================

function supportBoundingBox() {
  return readOption("enableBoundingBox", "true") === "true";
}

// ============================================================
// 3. 可选：自定义超时
// ============================================================

function pluginTimeoutInterval() {
  var val = parseInt(readOption("requestTimeout", String(DEFAULT_TIMEOUT)), 10);
  if (!isFinite(val) || val < 30) return DEFAULT_TIMEOUT;
  if (val > 300) return 300;
  return val;
}

// ============================================================
// 4. 可选：连接验证
// ============================================================

function pluginValidate(completion) {
  var cfg = getRuntimeConfig();

  $http.request({
    method: "GET",
    url: cfg.apiUrl + "/api/tags",
    header: buildAuthHeaders(cfg),
    timeout: 10,
    handler: function (resp) {
      if (resp.error || (resp.response && resp.response.statusCode >= 400)) {
        completion({
          result: false,
          error: {
            type: "network",
            message: "无法连接到 OCR 服务，请检查接口地址是否正确。",
            troubleshootingLink: "https://github.com/Fan-chou/bob-plugin-paddleocr"
          }
        });
        return;
      }
      completion({ result: true });
    }
  });
}

// ============================================================
// 5. 核心：OCR 入口
// ============================================================

function ocr(query, completion) {
  var cfg = getRuntimeConfig();

  if (!query || !query.image || typeof query.image.toBase64 !== "function") {
    completion({ error: { type: "param", message: "OCR 图片输入无效。" } });
    return;
  }

  if (supportBoundingBox()) {
    doTwoPhase(query, cfg, completion);
  } else {
    doSinglePhase(query, cfg, false, function (err, result) {
      if (err) completion({ error: err });
      else completion({ result: result });
    });
  }
}

// ============================================================
// 两阶段模式：Spotting → OCR
// ============================================================

function doTwoPhase(query, cfg, completion) {
  var b64 = query.image.toBase64();

  // 阶段 1：Spotting（不带冒号！）
  requestChat(b64, cfg, "Spotting", function (spotErr, spotText) {
    if (spotErr || !spotText) {
      $log.warn("[PaddleOCR] Spotting failed, fallback to OCR: " + (spotErr ? spotErr.message : "empty"));
      doSinglePhase(query, cfg, true, function (err, result) {
        if (err) completion({ error: err });
        else completion({ result: result });
      });
      return;
    }

    var locItems = parseLocTokens(spotText);

    if (!locItems || locItems.length === 0) {
      $log.warn("[PaddleOCR] No LOC tokens, fallback to OCR only");
      doSinglePhase(query, cfg, true, function (err, result) {
        if (err) completion({ error: err });
        else completion({ result: result });
      });
      return;
    }

    // 阶段 2：OCR（带冒号）
    requestChat(b64, cfg, "OCR:", function (ocrErr, ocrText) {
      if (ocrErr) {
        completion({ error: ocrErr });
        return;
      }

      var result = buildOcrResult(ocrText, locItems, query, cfg);
      if (result.error) {
        // 结构化失败，降级为纯文本
        $log.warn("[PaddleOCR] Structured build failed, raw text: " + ocrText.substring(0, 200));
        doSinglePhase(query, cfg, true, function (err2, result2) {
          if (err2) completion({ error: err2 });
          else completion({ result: result2 });
        });
      } else {
        completion({ result: result });
      }
    });
  });
}

// ============================================================
// 单阶段模式：纯 OCR
// ============================================================

function doSinglePhase(query, cfg, wasFallback, callback) {
  var b64 = query.image.toBase64();

  requestChat(b64, cfg, "OCR:", function (err, text) {
    if (err) {
      callback(err, null);
      return;
    }

    var lines = splitLines(text);
    if (!lines.length) {
      callback({ type: "notFound", message: "PaddleOCR 未识别到文本。" }, null);
      return;
    }

    var texts = [];
    for (var i = 0; i < lines.length; i++) {
      texts.push({ text: lines[i] });
    }

    callback(null, {
      from: query.detectFrom || query.from,
      texts: texts
    });
  });
}

// ============================================================
// 结果构建：LOC 坐标 + OCR 文本 → Bob OCR Result
// ============================================================

function buildOcrResult(ocrText, locItems, query, cfg) {
  var lines = splitLines(ocrText);
  if (!lines.length) {
    return {
      error: { type: "notFound", message: "PaddleOCR 未识别到文本。" }
    };
  }

  // 将 LOC items 与 OCR 文本行做匹配
  var matchedLines = matchLinesToLocs(lines, locItems);

  if (cfg.outputMode === "texts") {
    return buildTextsResult(matchedLines, query);
  }
  return buildRegionInfosResult(matchedLines, query);
}

// ---- 文本行与 LOC 条目的近似匹配 ----

function matchLinesToLocs(lines, locItems) {
  var result = [];

  // 策略：按 Y 坐标排序 LOC items（从上到下）
  var sortedLocs = locItems.slice().sort(function (a, b) {
    var ya = (a.points[0].y + a.points[2].y) / 2;
    var yb = (b.points[0].y + b.points[2].y) / 2;
    return ya - yb;
  });

  // 尝试为每行文本匹配最近的 LOC
  for (var i = 0; i < lines.length; i++) {
    var bestIdx = -1;
    var bestScore = Infinity;

    for (var j = 0; j < sortedLocs.length; j++) {
      var expectedY = (i / Math.max(lines.length - 1, 1));
      var actualY = (sortedLocs[j].points[0].y + sortedLocs[j].points[2].y) / 2;
      var score = Math.abs(actualY - expectedY);
      // 同时考虑文本相似度（Levenshtein 近似 → 简单子串包含）
      var textScore = textMatchScore(lines[i], sortedLocs[j].text);
      score += textScore * 0.3;
      if (score < bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }

    result.push({
      text: lines[i],
      boundingBox: bestIdx >= 0 ? sortedLocs[bestIdx] : undefined
    });
  }

  return result;
}

function textMatchScore(lineText, locText) {
  if (!locText) return 0.5;
  // 简单比较：共同字符的比例
  var shorter = lineText.length < locText.length ? lineText : locText;
  var longer = lineText.length < locText.length ? locText : lineText;
  if (shorter.length === 0) return 0.5;
  var matches = 0;
  for (var i = 0; i < shorter.length; i++) {
    if (longer.indexOf(shorter[i]) >= 0) matches++;
  }
  return 1 - (matches / shorter.length);
}

// ---- texts 扁平模式 ----

function buildTextsResult(matchedLines, query) {
  var texts = [];
  for (var i = 0; i < matchedLines.length; i++) {
    var item = { text: matchedLines[i].text };
    if (matchedLines[i].boundingBox) {
      item.boundingBox = matchedLines[i].boundingBox;
    }
    texts.push(item);
  }

  return {
    from: query.detectFrom || query.from,
    texts: texts
  };
}

// ---- regionInfos 结构化模式 ----

function buildRegionInfosResult(matchedLines, query) {
  // 按 Y 坐标将行分组为段落
  var paragraphs = groupIntoParagraphs(matchedLines);

  if (!paragraphs.length) {
    return {
      from: query.detectFrom || query.from,
      texts: matchedLines.map(function (m) {
        return { text: m.text };
      })
    };
  }

  return {
    from: query.detectFrom || query.from,
    regionInfos: [{
      boundingBox: calcEnclosingBox(paragraphs),
      paragraphInfos: paragraphs
    }]
  };
}

function groupIntoParagraphs(matchedLines) {
  if (matchedLines.length === 0) return [];

  var paras = [];
  var cur = {
    texts: [],
    boundingBox: undefined
  };

  for (var i = 0; i < matchedLines.length; i++) {
    var prev = i > 0 ? matchedLines[i - 1] : null;
    var item = matchedLines[i];

    if (cur.texts.length > 0 && isParaBreak(prev, item)) {
      cur.boundingBox = calcParaBox(cur.texts);
      paras.push(cur);
      cur = { texts: [], boundingBox: undefined };
    }

    cur.texts.push({
      text: item.text,
      boundingBox: item.boundingBox
    });
  }

  cur.boundingBox = calcParaBox(cur.texts);
  paras.push(cur);
  return paras;
}

function isParaBreak(prev, curr) {
  if (!prev || !curr) return false;
  if (!prev.boundingBox || !curr.boundingBox) return true;

  var prevY = (prev.boundingBox.points[0].y + prev.boundingBox.points[2].y) / 2;
  var currY = (curr.boundingBox.points[0].y + curr.boundingBox.points[2].y) / 2;
  var lineH = Math.abs(prev.boundingBox.points[2].y - prev.boundingBox.points[0].y);

  return (currY - prevY) > lineH * 1.8;
}

function calcParaBox(texts) {
  var boxes = [];
  for (var i = 0; i < texts.length; i++) {
    if (texts[i].boundingBox) boxes.push(texts[i].boundingBox);
  }
  return boxes.length > 0 ? calcMinMaxBox(boxes) : undefined;
}

function calcEnclosingBox(paras) {
  var boxes = [];
  for (var i = 0; i < paras.length; i++) {
    if (paras[i].boundingBox) boxes.push(paras[i].boundingBox);
  }
  return boxes.length > 0 ? calcMinMaxBox(boxes) : undefined;
}

function calcMinMaxBox(boxes) {
  var minX = 1, minY = 1, maxX = 0, maxY = 0;
  for (var i = 0; i < boxes.length; i++) {
    var pts = boxes[i].points;
    for (var j = 0; j < pts.length; j++) {
      if (pts[j].x < minX) minX = pts[j].x;
      if (pts[j].y < minY) minY = pts[j].y;
      if (pts[j].x > maxX) maxX = pts[j].x;
      if (pts[j].y > maxY) maxY = pts[j].y;
    }
  }
  return {
    points: [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: minX, y: maxY },
      { x: maxX, y: maxY }
    ]
  };
}

// ============================================================
// LOC Token 解析
// 格式: text<|LOC_x1|><|LOC_y1|>...<|LOC_x4|><|LOC_y4|>
// 坐标值范围 [0, 1000]，归一化到 [0, 1]
// ============================================================

function parseLocTokens(text) {
  if (!text) return [];

  var locRegex = /<\|LOC_(\d+)\|>/g;
  var allMatches = [];
  var m;

  while ((m = locRegex.exec(text)) !== null) {
    allMatches.push({ idx: m.index, val: parseInt(m[1], 10), len: m[0].length });
  }

  if (allMatches.length < 8) return [];

  var results = [];

  // 每 8 个 LOC token 为一组
  for (var groupStart = 0; groupStart + 7 < allMatches.length; groupStart += 8) {
    var startIdx = allMatches[groupStart].idx;
    var endIdx = allMatches[groupStart + 7].idx + allMatches[groupStart + 7].len;

    // 提取该组之前的文本标签
    var prevEnd = groupStart > 0
      ? allMatches[groupStart - 1].idx + allMatches[groupStart - 1].len
      : 0;
    var label = text.substring(prevEnd, startIdx)
      .replace(/<\|[^|]+\|>/g, "")
      .replace(/\n/g, " ")
      .trim();

    // 如果是紧邻的连续组，label 可能为空的，跳过
    // 提取坐标
    var coords = [];
    for (var j = 0; j < 8; j += 2) {
      coords.push({
        x: clamp(allMatches[groupStart + j].val / LOC_GRID_SIZE),
        y: clamp(allMatches[groupStart + j + 1].val / LOC_GRID_SIZE)
      });
    }

    results.push({
      text: label,
      points: [
        { x: coords[0].x, y: coords[0].y },
        { x: coords[1].x, y: coords[1].y },
        { x: coords[2].x, y: coords[2].y },
        { x: coords[3].x, y: coords[3].y }
      ]
    });
  }

  return results;
}

function clamp(val) {
  if (val < 0) return 0;
  if (val > 1) return 1;
  return val;
}

// ============================================================
// API 请求：OpenAI 兼容 /v1/chat/completions
// ============================================================

function requestChat(base64Image, cfg, prompt, callback) {
  var body = {
    model: cfg.model,
    messages: [{
      role: "user",
      content: [
        {
          type: "image_url",
          image_url: { url: "data:image/png;base64," + base64Image }
        },
        { type: "text", text: prompt }
      ]
    }],
    stream: false,
    options: { num_predict: 2048 }
  };

  $http.request({
    method: "POST",
    url: cfg.apiUrl + "/v1/chat/completions",
    header: buildAuthHeaders(cfg),
    body: body,
    timeout: pluginTimeoutInterval(),
    handler: function (resp) {
      if (resp.error) {
        callback(
          { type: "network", message: "请求失败: " + String(resp.error) },
          null
        );
        return;
      }

      var sc = resp.response && resp.response.statusCode;
      if (sc !== 200) {
        callback(buildServiceError(sc, resp.data), null);
        return;
      }

      try {
        var content = "";
        var data = resp.data;
        if (data && data.choices && data.choices[0] && data.choices[0].message) {
          content = String(data.choices[0].message.content || "");
        }
        callback(null, content);
      } catch (e) {
        callback({ type: "api", message: "解析响应失败: " + String(e) }, null);
      }
    }
  });
}

// ============================================================
// 辅助函数
// ============================================================

function splitLines(text) {
  if (!text) return [];
  return String(text).split(/\n/).map(function (l) {
    return l.replace(/^\s+|\s+$/g, "");
  }).filter(function (l) {
    return l.length > 0;
  });
}

function buildAuthHeaders(cfg) {
  var h = { "Content-Type": "application/json" };
  if (cfg.apiKey) {
    h["Authorization"] = "Bearer " + cfg.apiKey;
  }
  return h;
}

function readOption(name, fallback) {
  if (typeof $option === "undefined" || !$option) return fallback;
  var v = $option[name];
  return (v === undefined || v === null || v === "") ? fallback : v;
}

function getRuntimeConfig() {
  return {
    apiUrl: normalizeUrl(readOption("apiUrl", DEFAULT_API_URL)),
    apiKey: String(readOption("apiKey", "")).trim(),
    model: String(readOption("model", DEFAULT_MODEL)).trim() || DEFAULT_MODEL,
    outputMode: readOption("outputMode", "regionInfos")
  };
}

function normalizeUrl(url) {
  return String(url || "").replace(/\/+$/, "");
}

function buildServiceError(sc, data) {
  var type = "api";
  var msg = getErrorMsg(data, "HTTP " + sc);

  if (sc === 401 || sc === 403) {
    type = "secretKey";
    msg = "API 密钥无效或已过期。";
  } else if (sc === 429) {
    type = "network";
    msg = "请求过于频繁，请稍后再试。";
  } else if (sc >= 500) {
    type = "network";
    msg = "OCR 服务暂时不可用。";
  }

  return { type: type, message: msg };
}

function getErrorMsg(data, fb) {
  if (!data) return fb;
  if (typeof data === "string") return data;
  if (data.message) return String(data.message);
  if (data.error) {
    if (typeof data.error === "string") return data.error;
    if (data.error.message) return String(data.error.message);
  }
  return fb;
}

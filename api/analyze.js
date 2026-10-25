// Сервер для распознавания еды через Gemini.
// Ключ берётся из переменной окружения GEMINI_API_KEY (задаётся в настройках Vercel).
// Необязательно: GEMINI_MODEL — своя модель; APP_CODE — код доступа, чтобы чужие не тратили твой лимит.

const DEFAULT_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];

const FORMAT = `Ответь только JSON такого вида:
{"items":[{"name":"Творог 5%","grams":200,"kcal100":121,"protein100":17,"fat100":5,"carbs100":1.8,"source":"label"}]}
Названия по-русски, коротко. Числа без единиц. Калории в ккал, не в кДж.`;

function promptFor(mode, note, text) {
  const extra = note ? `\nУточнение от пользователя: ${String(note).slice(0, 300)}` : "";
  if (mode === "text") {
    return `Ты нутрициолог. Пользователь описал, что съел: «${String(text || "").slice(0, 1500)}».
Раздели на отдельные продукты или блюда. Если вес указан, используй его, иначе возьми обычную порцию.
Дай типичную пищевую ценность на 100 г (для готовых блюд в готовом виде). Для всех "source":"estimate".
${FORMAT}
Если это не еда, ответь {"items":[]}.`;
  }
  return `Ты нутрициолог. На фото либо еда (тарелка, блюдо, перекус), либо упаковка продукта.
Если видна таблица пищевой ценности на упаковке, бери цифры на 100 г прямо с неё, название с упаковки, вес — массу нетто, если видна, иначе 100. Для такого продукта "source":"label".
Если это готовая еда без этикетки, найди каждое отдельное блюдо или продукт, оцени вес порции в граммах по тому, что видно (размер тарелки, приборы), и типичную пищевую ценность на 100 г. Для них "source":"estimate".${extra}
${FORMAT}
Если еды и этикетки на фото нет, ответь {"items":[]}.`;
}

function num(v) {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : 0;
}

function cleanItems(raw) {
  const arr = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [];
  return arr
    .map((x) => ({
      name: String(x?.name || "Продукт").slice(0, 80),
      grams: Math.max(1, Math.round(num(x?.grams) || 100)),
      kcal100: num(x?.kcal100),
      protein100: num(x?.protein100),
      fat100: num(x?.fat100),
      carbs100: num(x?.carbs100),
      source: x?.source === "label" ? "label" : "estimate",
    }))
    .filter((x) => x.kcal100 > 0 || x.protein100 > 0 || x.carbs100 > 0)
    .slice(0, 12);
}

function parseJson(text) {
  try { return JSON.parse(text); } catch {}
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch {} }
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch {} }
  return null;
}

async function callGemini(key, model, parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  const text = (body?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  return text;
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "Нужен POST-запрос" });

  const key = process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: "На сервере не задан ключ GEMINI_API_KEY. Добавь его в настройках Vercel и сделай Redeploy." });

  const code = process.env.APP_CODE;
  if (code && req.headers["x-app-code"] !== code) {
    return res.status(401).json({ error: "Неверный код доступа", needCode: true });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const { mode = "photo", image, mime = "image/jpeg", note, text } = body || {};

  const parts = [{ text: promptFor(mode, note, text) }];
  if (mode !== "text") {
    if (!image || typeof image !== "string") return res.status(400).json({ error: "Фото не дошло до сервера" });
    parts.push({ inline_data: { mime_type: /^image\/(jpeg|png|webp)$/.test(mime) ? mime : "image/jpeg", data: image } });
  } else if (!text) {
    return res.status(400).json({ error: "Пустое описание" });
  }

  const models = [process.env.GEMINI_MODEL, ...DEFAULT_MODELS].filter(Boolean);
  let lastErr;
  for (const model of [...new Set(models)]) {
    try {
      const out = await callGemini(key, model, parts);
      const items = cleanItems(parseJson(out));
      return res.status(200).json({ items, model });
    } catch (e) {
      lastErr = e;
      // 404 — модели нет, 429 — кончился лимит этой модели: пробуем следующую
      if (e.status !== 404 && e.status !== 429 && e.status !== 400) break;
    }
  }
  const st = lastErr?.status;
  const msg = st === 429 ? "Дневной бесплатный лимит Gemini закончился. Завтра снова заработает, а пока впиши еду вручную."
    : st === 403 || st === 401 ? "Gemini не принял ключ. Проверь GEMINI_API_KEY в настройках Vercel."
    : st === 400 && /location|region|country/i.test(lastErr?.message || "") ? "Gemini недоступен из региона сервера."
    : "Не получилось распознать. Попробуй ещё раз.";
  return res.status(502).json({ error: msg, detail: String(lastErr?.message || "").slice(0, 300) });
};

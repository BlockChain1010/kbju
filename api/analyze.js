// Сервер для приложения «Дневник КБЖУ»: распознавание еды, продуктов, идеи блюд, рецепты и меню через Gemini.
// Ключ: GEMINI_API_KEY. Необязательно: GEMINI_MODEL — своя модель; APP_CODE — код доступа.

const DEFAULT_MODELS = ["gemini-flash-lite-latest", "gemini-flash-latest"];

const ITEM_FORMAT = `Ответь только JSON такого вида:
{"items":[{"name":"Творог 5%","grams":200,"kcal100":121,"protein100":17,"fat100":5,"carbs100":1.8,"source":"label"}]}
Названия по-русски, коротко. Числа без единиц. Калории в ккал, не в кДж.`;

const RECIPE_SHAPE = `{"name":"Курица с рисом и овощами","servings":2,"minutes":40,"cookedWeight":900,
"ingredients":[{"name":"Рис","grams":150,"kcal100":344,"protein100":7,"fat100":0.6,"carbs100":78,"have":true}],
"steps":["Промой рис…","…"]}`;

const RECIPE_RULES = `Ингредиенты — в граммах СЫРЫМИ, пищевая ценность на 100 г СЫРОГО продукта. "have": true, если продукт есть в списке «есть дома» (соль, перец и вода — всегда true). cookedWeight — примерный вес всего готового блюда в граммах. Шаги короткие, до 8 штук. Обычные продукты из российских магазинов. Всё по-русски.`;

function clip(s, n) { return String(s || "").slice(0, n); }
function pantryText(p) {
  const arr = Array.isArray(p) ? p.map((x) => clip(x, 60)).filter(Boolean).slice(0, 80) : [];
  return arr.length ? arr.join(", ") : "ничего не указано";
}

function profileText(p) {
  if (!p || typeof p !== "object") return "ничего";
  const parts = [];
  if (p.sex) parts.push(p.sex === "f" ? "женщина" : "мужчина");
  if (p.age) parts.push(`${parseInt(p.age)} лет`);
  if (p.height) parts.push(`рост ${parseInt(p.height)} см`);
  if (p.weight) parts.push(`вес ${num(p.weight)} кг`);
  if (p.goal) parts.push(`цель по питанию: ${clip(p.goal, 40)}`);
  return parts.length ? parts.join(", ") : "ничего";
}

function promptFor(b) {
  const extra = b.note ? `\nУточнение от пользователя: ${clip(b.note, 300)}` : "";
  const wish = b.wish ? `\nПожелания: ${clip(b.wish, 300)}` : "";
  const servings = Math.min(12, Math.max(1, parseInt(b.servings) || 2));
  switch (b.mode) {
    case "text":
      return `Ты нутрициолог. Пользователь описал, что съел: «${clip(b.text, 1500)}».
Раздели на отдельные продукты или блюда. Если вес указан, используй его, иначе возьми обычную порцию.
Дай типичную пищевую ценность на 100 г (для готовых блюд в готовом виде; если сказано, что продукты сырые, — для сырых). Для всех "source":"estimate".
${ITEM_FORMAT}
Если это не еда, ответь {"items":[]}.`;
    case "pantry":
      return b.image
        ? `На фото холодильник, полка или продукты. Перечисли все продукты, которые можно разглядеть, по-русски, коротко и обобщённо («яйца», «куриное филе», «сыр твёрдый»). Не выдумывай то, чего не видно.
Ответь только JSON: {"products":["яйца","молоко"]}. Если продуктов не видно — {"products":[]}.`
        : `Пользователь перечислил продукты: «${clip(b.text, 1000)}». Приведи к списку коротких названий по-русски.
Ответь только JSON: {"products":["яйца","молоко"]}.`;
    case "ideas":
      return `Ты повар и нутрициолог. Дома есть: ${pantryText(b.pantry)}.${wish}
Предложи 5 разных несложных блюд, которые можно приготовить в основном из этих продуктов (можно 1–2 недостающих). Порций: ${servings}.
Ответь только JSON: {"ideas":[{"name":"Омлет с сыром и помидорами","about":"Быстрый завтрак за 10 минут","minutes":10,"kcalPerServing":420,"missing":["помидоры"]}]}
missing — чего нет в списке «есть дома» (соль, перец, вода не считаются). Всё по-русски.`;
    case "recipe":
      return `Ты повар и нутрициолог. Составь рецепт: «${clip(b.query, 300)}». Порций: ${servings}.
Дома есть: ${pantryText(b.pantry)}. По возможности используй их.${wish}
${RECIPE_RULES}
Ответь только JSON: {"recipe":${RECIPE_SHAPE}}`;
    case "menu": {
      const count = Math.min(6, Math.max(2, parseInt(b.count) || 4));
      return `Ты повар и нутрициолог. Составь меню на неделю для готовки заранее: ${count} разных блюд (завтраки, обеды, ужины вперемешку), каждое на ${servings} порций и так, чтобы хорошо хранилось в холодильнике 2–4 дня.
Дома есть: ${pantryText(b.pantry)}. Используй это в первую очередь.${wish}
${RECIPE_RULES}
Ответь только JSON: {"recipes":[${RECIPE_SHAPE}]}`;
    }
    case "review": {
      const isWeek = b.scope === "week";
      const live = !isWeek && b.isToday ? `\nСейчас ${parseInt(b.hour) || 12}:00, день ещё не закончился — учитывай, что впереди ещё приёмы пищи, и подскажи, как добрать или уложиться до конца дня.` : "";
      return `Ты внимательный и доброжелательный нутрициолог. Разбери рацион пользователя за ${isWeek ? "последние 7 дней" : "день"}.
Данные (калории в ккал, БЖУ в граммах): ${clip(JSON.stringify(b.data || {}), 9000)}${live}
Оцени баланс калорий, белков, жиров и углеводов относительно цели, качество продуктов, распределение по приёмам пищи${isWeek ? ", стабильность по дням" : ""}.
Советы — конкретные: какие продукты добавить или заменить, с примерами блюд и граммами. Не советуй есть меньше нормы и не предлагай голодать. Если записей мало — так и скажи и дай общий совет.
Ответь только JSON: {"verdict":"итог в 1–2 предложениях","good":["что получается хорошо"],"fix":["что поправить"],"next":["${isWeek ? "план на следующую неделю" : (b.isToday ? "что съесть до конца дня" : "что съесть завтра")}"]}
До 4 пунктов в каждом списке, каждый пункт — одно-два коротких предложения. По-русски, обращайся на «ты».`;
    }
    case "wq":
      return `Ты фитнес-тренер. Пользователь хочет программу тренировок ${b.place === "home" ? "дома" : "в тренажёрном зале"}.
Что известно: ${profileText(b.profile)}.
Задай 5–7 самых важных вопросов, чтобы составить подходящую программу. Обязательно спроси: уровень подготовки, сколько дней в неделю готов заниматься, сколько времени на одну тренировку, главная цель, есть ли травмы или ограничения${b.place === "home" ? ", какой инвентарь есть дома" : ""}. Не спрашивай то, что уже известно.
Для каждого вопроса дай 2–6 коротких вариантов ответа. "multi": true, если можно выбрать несколько.
Ответь только JSON: {"questions":[{"q":"Сколько дней в неделю готов заниматься?","options":["2","3","4","5"],"multi":false}]}. По-русски.`;
    case "workout":
      return `Ты опытный фитнес-тренер. Составь программу тренировок ${b.place === "home" ? "дома" : "в тренажёрном зале"}.
Профиль: ${profileText(b.profile)}.
Ответы на вопросы: ${clip((Array.isArray(b.answers) ? b.answers : []).map((x) => `${clip(x?.q, 150)} — ${clip(x?.a, 200) || "без ответа"}`).join("; "), 3000)}.${b.extra ? `\nДополнительно: ${clip(b.extra, 500)}` : ""}
Требования: число тренировочных дней — как в ответах; упражнения безопасны для уровня; если есть травмы — исключи нагрузку на эту зону и добавь в notes совет показаться врачу; ${b.place === "home" ? "используй только инвентарь, который есть" : "используй обычное оборудование зала"}; 4–7 упражнений в дне; короткая разминка.
Ответь только JSON: {"name":"Название программы","daysPerWeek":3,"warmup":"разминка в 1–3 предложениях","days":[{"title":"День 1 · Всё тело","exercises":[{"name":"Приседания с гантелями","sets":3,"reps":"10–12","rest":"60–90 сек","tip":"подсказка по технике"}]}],"progression":"как увеличивать нагрузку","notes":["советы"]}
По-русски.`;
    default:
      return `Ты нутрициолог. На фото либо еда (тарелка, блюдо, перекус), либо упаковка продукта.
Если видна таблица пищевой ценности на упаковке, бери цифры на 100 г прямо с неё, название с упаковки, вес — массу нетто, если видна, иначе 100. Для такого продукта "source":"label".
Если это готовая еда без этикетки, найди каждое отдельное блюдо или продукт, оцени вес порции в граммах по тому, что видно (размер тарелки, приборы), и типичную пищевую ценность на 100 г. Для них "source":"estimate".${extra}
${ITEM_FORMAT}
Если еды и этикетки на фото нет, ответь {"items":[]}.`;
  }
}

function num(v) {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : 0;
}

function cleanItems(raw) {
  const arr = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw) ? raw : [];
  return arr
    .map((x) => ({
      name: clip(x?.name || "Продукт", 80),
      grams: Math.max(1, Math.round(num(x?.grams) || 100)),
      kcal100: num(x?.kcal100), protein100: num(x?.protein100), fat100: num(x?.fat100), carbs100: num(x?.carbs100),
      source: x?.source === "label" ? "label" : "estimate",
    }))
    .filter((x) => x.kcal100 > 0 || x.protein100 > 0 || x.carbs100 > 0)
    .slice(0, 12);
}

function cleanRecipe(r) {
  if (!r || typeof r !== "object") return null;
  const ingredients = (Array.isArray(r.ingredients) ? r.ingredients : [])
    .map((i) => ({
      name: clip(i?.name || "Продукт", 60),
      grams: Math.max(0, Math.round(num(i?.grams))),
      kcal100: num(i?.kcal100), protein100: num(i?.protein100), fat100: num(i?.fat100), carbs100: num(i?.carbs100),
      have: !!i?.have,
    }))
    .filter((i) => i.name)
    .slice(0, 20);
  if (!ingredients.length) return null;
  return {
    name: clip(r.name || "Рецепт", 80),
    servings: Math.max(1, Math.round(num(r.servings) || 2)),
    minutes: Math.round(num(r.minutes)) || null,
    cookedWeight: Math.round(num(r.cookedWeight)) || null,
    ingredients,
    steps: (Array.isArray(r.steps) ? r.steps : []).map((s) => clip(s, 400)).filter(Boolean).slice(0, 12),
  };
}

function shape(mode, raw) {
  switch (mode) {
    case "pantry":
      return { products: (Array.isArray(raw?.products) ? raw.products : []).map((p) => clip(typeof p === "string" ? p : p?.name, 60)).filter(Boolean).slice(0, 60) };
    case "ideas":
      return {
        ideas: (Array.isArray(raw?.ideas) ? raw.ideas : []).map((x) => ({
          name: clip(x?.name || "Блюдо", 80), about: clip(x?.about, 200),
          minutes: Math.round(num(x?.minutes)) || null, kcalPerServing: Math.round(num(x?.kcalPerServing)) || null,
          missing: (Array.isArray(x?.missing) ? x.missing : []).map((m) => clip(m, 40)).filter(Boolean).slice(0, 8),
        })).slice(0, 6),
      };
    case "recipe":
      return { recipe: cleanRecipe(raw?.recipe || raw) };
    case "menu":
      return { recipes: (Array.isArray(raw?.recipes) ? raw.recipes : []).map(cleanRecipe).filter(Boolean).slice(0, 6) };
    case "review": {
      const list = (k) => (Array.isArray(raw?.[k]) ? raw[k] : []).map((x) => clip(x, 400)).filter(Boolean).slice(0, 5);
      return { review: { verdict: clip(raw?.verdict, 500), good: list("good"), fix: list("fix"), next: list("next") } };
    }
    case "wq":
      return { questions: (Array.isArray(raw?.questions) ? raw.questions : []).map((x) => ({
        q: clip(x?.q, 200),
        options: (Array.isArray(x?.options) ? x.options : []).map((o) => clip(o, 60)).filter(Boolean).slice(0, 8),
        multi: !!x?.multi,
      })).filter((x) => x.q).slice(0, 8) };
    case "workout": {
      const days = (Array.isArray(raw?.days) ? raw.days : []).map((d, i) => ({
        title: clip(d?.title || `День ${i + 1}`, 80),
        exercises: (Array.isArray(d?.exercises) ? d.exercises : []).map((e) => ({
          name: clip(e?.name, 80), sets: clip(e?.sets, 10), reps: clip(e?.reps, 20), rest: clip(e?.rest, 30), tip: clip(e?.tip, 240),
        })).filter((e) => e.name).slice(0, 10),
      })).filter((d) => d.exercises.length).slice(0, 7);
      return { program: days.length ? {
        name: clip(raw?.name || "Моя программа", 80), daysPerWeek: Math.round(num(raw?.daysPerWeek)) || days.length,
        warmup: clip(raw?.warmup, 600), progression: clip(raw?.progression, 600),
        notes: (Array.isArray(raw?.notes) ? raw.notes : []).map((x) => clip(x, 300)).filter(Boolean).slice(0, 6), days,
      } : null };
    }
    default:
      return { items: cleanItems(raw) };
  }
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
      generationConfig: { temperature: 0.4, responseMimeType: "application/json", maxOutputTokens: 8192 },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body?.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return (body?.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
}

const MODES = ["photo", "text", "pantry", "ideas", "recipe", "menu", "review", "wq", "workout"];

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
  body = body || {};
  const mode = MODES.includes(body.mode) ? body.mode : "photo";
  const needsImage = mode === "photo" || (mode === "pantry" && !body.text);

  const parts = [{ text: promptFor({ ...body, mode }) }];
  if (needsImage) {
    if (!body.image || typeof body.image !== "string") return res.status(400).json({ error: "Фото не дошло до сервера" });
    parts.push({ inline_data: { mime_type: /^image\/(jpeg|png|webp)$/.test(body.mime) ? body.mime : "image/jpeg", data: body.image } });
  } else if (mode === "text" && !body.text) {
    return res.status(400).json({ error: "Пустое описание" });
  } else if (mode === "recipe" && !body.query) {
    return res.status(400).json({ error: "Напиши, какой рецепт нужен" });
  }

  const models = [process.env.GEMINI_MODEL, ...DEFAULT_MODELS].filter(Boolean);
  let lastErr;
  for (const model of [...new Set(models)]) {
    try {
      const out = await callGemini(key, model, parts);
      const parsed = parseJson(out);
      if (!parsed) { lastErr = new Error("Gemini вернул нечитаемый ответ"); lastErr.status = 422; continue; }
      return res.status(200).json({ ...shape(mode, parsed), model });
    } catch (e) {
      lastErr = e;
      // 404 — модели нет, 429 — кончился лимит этой модели, 400/5xx — пробуем следующую
      if (![400, 404, 429, 500, 503].includes(e.status)) break;
    }
  }
  const st = lastErr?.status;
  const msg = st === 429 ? "Дневной бесплатный лимит Gemini закончился. Завтра снова заработает, а пока впиши еду вручную."
    : st === 403 || st === 401 ? "Gemini не принял ключ. Проверь GEMINI_API_KEY в настройках Vercel."
    : st === 400 && /location|region|country/i.test(lastErr?.message || "") ? "Gemini недоступен из региона сервера."
    : st === 422 ? "Ответ получился нечитаемым. Попробуй ещё раз."
    : "Не получилось получить ответ. Попробуй ещё раз.";
  return res.status(502).json({ error: msg, detail: clip(lastErr?.message, 300) });
};

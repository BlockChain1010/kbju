# Дневник КБЖУ

Калькулятор калорий: фото еды и этикеток (Gemini), живой сканер штрих-кодов (база Open Food Facts), ручной ввод, цели на день. Данные хранятся на телефоне.

## Как запустить

1. **Ключ Gemini.** С включённым VPN открой aistudio.google.com → Get API key → Create API key. Скопируй ключ.
2. **GitHub.** github.com → Sign up (можно через Google). Нажми «+» → New repository → имя `kbju` → Create repository. На следующей странице нажми ссылку «uploading an existing file» и перетащи **всё содержимое** этой папки (файлы и папки `api`, `icons`, не саму папку) → Commit changes.
3. **Vercel.** vercel.com → Sign up → Continue with GitHub → тариф Hobby. Add New → Project → Import рядом с `kbju`. Раскрой Environment Variables: Name `GEMINI_API_KEY`, Value — твой ключ → Add → Deploy.
4. **Телефон.** Открой в Chrome адрес вида `kbju-….vercel.app` → меню ⋮ → «Установить приложение» (или «Добавить на главный экран»). При первом сканировании разреши камеру.

## Необязательно

- `APP_CODE` — любой код в переменных Vercel. Тогда приложение попросит его один раз в настройках, и чужие не смогут тратить твой лимит Gemini.
- `GEMINI_MODEL` — своя модель Gemini. По умолчанию `gemini-flash-lite-latest`, при исчерпании лимита — `gemini-flash-latest`.
- После изменения переменных в Vercel: Deployments → ⋯ → Redeploy.

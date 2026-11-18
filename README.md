# Юр-Квиз — игра как Kahoot

Викторина «Понимание и оценка юридически значимых фактов» (12 вопросов).
Node.js + Express + Socket.IO + MongoDB. Регистрация по имени, логину и паролю.

---

## ШАГ 1. MongoDB Atlas (база данных, бесплатно)

1. Зайдите на https://www.mongodb.com/atlas → Sign up.
2. Create → тариф **M0 (Free)** → Create Deployment.
3. **Database Access** → Add New Database User → придумайте логин и пароль
   (пароль лучше только из букв и цифр) → сохраните их.
4. **Network Access** → Add IP Address → **Allow access from anywhere** (`0.0.0.0/0`) → Confirm.
   (Это нужно, чтобы Render мог подключиться.)
5. **Database → Connect → Drivers** → скопируйте строку вида:
   `mongodb+srv://ЛОГИН:ПАРОЛЬ@cluster0.xxxxx.mongodb.net/`
   Замените `ЛОГИН` и `ПАРОЛЬ` на свои и **допишите имя базы** перед `?` или в конце:
   `mongodb+srv://ЛОГИН:ПАРОЛЬ@cluster0.xxxxx.mongodb.net/legal-quiz`

## ШАГ 2. GitHub

1. https://github.com/new → имя репозитория `legal-quiz` → Create repository.
2. Нажмите **uploading an existing file** и перетащите **все файлы из папки проекта**
   (`server.js`, `package.json`, `questions.js`, `render.yaml`, `.gitignore`, `index.html`) → Commit changes.
   Папку `node_modules` и файл `.env` загружать НЕ нужно.

Или через терминал:
```
git init
git add .
git commit -m "Юр-Квиз"
git branch -M main
git remote add origin https://github.com/ВАШ_НИК/legal-quiz.git
git push -u origin main
```

## ШАГ 3. Render (хостинг)

1. https://render.com → войдите через GitHub.
2. **New → Web Service** → выберите репозиторий `legal-quiz`.
   (Либо **New → Blueprint** — Render сам прочитает `render.yaml`.)
3. Настройки: Runtime **Node**, Build Command `npm install`, Start Command `npm start`, Plan **Free**.
4. **Environment** → добавьте переменные:
   - `MONGODB_URI` = строка из Шага 1
   - `ADMIN_PASSWORD` = пароль админа MrGarder (придумайте сами)
   - `JWT_SECRET` = любая длинная случайная строка
5. **Create Web Service**. Через 2–3 минуты получите ссылку `https://legal-quiz-xxxx.onrender.com`.

Бесплатный Render «засыпает» после 15 минут без заходов — первый запуск потом занимает ~50 секунд.
Откройте сайт за минуту до игры.

## Админ и баллы

- Аккаунт **MrGarder** создаётся автоматически. Войти: логин `MrGarder`, пароль из `ADMIN_PASSWORD`.
- Только админ создаёт, начинает и завершает игру (кнопка «Завершить игру» есть на каждом экране ведущего).
- Верный ответ: **+1 балл**, неверный: **−1 балл**, нет ответа: 0. Баллы могут уходить в минус.
- «Рейтинг участников» в меню: общий рейтинг по всем играм из MongoDB.
- Логин `MrGarder` нельзя зарегистрировать как обычный.

## Как играть

- Все регистрируются (имя, логин, пароль).
- Админ MrGarder: «Создать игру» → на экране PIN.
- Игроки: открывают ту же ссылку с телефона → вводят PIN → «Войти в игру».
- Ведущий жмёт «Начать игру». За верный ответ +1 балл, за неверный −1.
- Результаты сохраняются в MongoDB, в меню есть таблица лидеров.

## Свои вопросы

Правьте `questions.js`, затем один раз поставьте в Render переменную `RESEED=1`
(после перезапуска удалите её), и вопросы обновятся в базе.

## Локальный запуск

```
npm install
cp .env.example .env     # впишите MONGODB_URI
npm start                # http://localhost:3000
```

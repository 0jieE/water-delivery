# Web-Based Water Refilling Delivery and Logistic System

Three-tier architecture:

```
[ React SPA (frontend/) ] --HTTPS/JSON--> [ Django REST API (backend/) ] --> [ Database ]
```

The browser never connects to the database; only the API does.

## Setup (Windows)

### 1. Database
Development uses SQLite (`backend/db.sqlite3`, created automatically by `migrate`). Nothing to install.

For deployment, switch to PostgreSQL: set `DB_ENGINE=postgres` and the `DB_*` values in `backend/.env`,
`pip install -r requirements-prod.txt`, then run `python manage.py migrate`.
(`docker compose up -d` starts a local PostgreSQL if you want to test the switch.)

### 2. Backend
```powershell
cd backend
python -m venv venv
venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python manage.py makemigrations
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
```
API: http://localhost:8000/api/  ·  Django admin: http://localhost:8000/admin/

### 3. Frontend
```powershell
cd frontend
copy .env.example .env
npm install
npm run dev
```
App: http://localhost:5173

## Build the rest
Open this folder in Claude Code and paste the contents of `PROMPT.md`.

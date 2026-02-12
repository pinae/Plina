# Plina
Pina's Todo and Planning Tool.

## Development Setup

### Backend (Django)

1.  Navigate to the `plina` directory:
    ```bash
    cd plina
    ```
2.  Install dependencies (if not already installed):
    ```bash
    .venv/bin/pip install -r requirements.txt
    ```
3.  Start the development server:
    ```bash
    .venv/bin/python manage.py runserver
    ```
    The backend will be available at `http://localhost:8000`.

### Frontend (React/Vite)

1.  Navigate to the `frontend` directory:
    ```bash
    cd plina/frontend
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```
3.  Start the development server:
    ```bash
    npm run dev
    ```
    The frontend will be available at `http://localhost:5173`.

## Testing

### Backend Tests
Run Django tests from the `plina` directory:
```bash
python manage.py test tasks
```

### Frontend Tests
Run Vitest from the `frontend` directory:
```bash
npm test
```

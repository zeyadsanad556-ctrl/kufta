FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    KUFTA_ENV=production

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app.js index.html logo.png server.py styles.css ./

RUN useradd --system --uid 10001 kufta && \
    mkdir -p /app/data && \
    chown kufta:kufta /app/data

USER kufta

EXPOSE 8000

CMD ["python", "server.py"]

FROM python:3.11-slim

WORKDIR /app

RUN apt-get update && apt-get install -y \
    git \
    git-lfs \
    ffmpeg \
    libsm6 \
    libxext6 \
    libgl1 \
    && rm -rf /var/lib/apt/lists/*

COPY . /app

RUN pip install --upgrade pip

RUN pip install -r requirements.txt

EXPOSE 7860

CMD ["python", "app.py"]

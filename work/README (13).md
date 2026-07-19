---
title: YogaMate
emoji: 🧘
colorFrom: purple
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# YogaMate – AI Yoga Pose Correction

Upload a photo of your yoga pose and get real-time posture analysis powered by MediaPipe.

## Features
- Detects body landmarks using MediaPipe Pose
- Compares your pose angles against a reference database
- Returns an accuracy score + specific correction suggestions
- Supports 12+ yoga asanas

## Setup
```bash
pip install -r requirements.txt
python app.py
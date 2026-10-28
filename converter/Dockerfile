# Converter for a rented GPU machine (needs NVIDIA GPU + docker with the NVIDIA runtime).
FROM pytorch/pytorch:2.4.0-cuda12.1-cudnn9-runtime
RUN apt-get update && apt-get install -y --no-install-recommends git ffmpeg libsndfile1 && rm -rf /var/lib/apt/lists/*
RUN git clone https://github.com/Plachtaa/seed-vc /opt/seed-vc && pip install --no-cache-dir -r /opt/seed-vc/requirements.txt
WORKDIR /app
COPY server.py .
ENV SEED_VC_DIR=/opt/seed-vc
EXPOSE 8000
CMD ["python", "server.py"]

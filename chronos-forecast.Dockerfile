FROM python:3.11-slim

WORKDIR /app

# CPU-only torch wheel -- the default PyPI torch pulls CUDA libraries this
# box will never use (no GPU on the Umbrel host), which roughly doubles
# image size and build time for nothing. Installed before requirements.txt
# so pip resolves chronos-forecasting's torch dependency against this build
# instead of fetching the default CUDA one.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY chronos-forecast-requirements.txt requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Bakes the model weights into the image at build time instead of pulling
# them from Hugging Face on every container (re)start -- keeps restarts
# fast and means this service needs no outbound internet at runtime, same
# offline-after-build posture as every other service in this stack.
ARG CHRONOS_MODEL=amazon/chronos-2
ENV CHRONOS_MODEL=${CHRONOS_MODEL}
RUN python -c "from chronos import Chronos2Pipeline; Chronos2Pipeline.from_pretrained('${CHRONOS_MODEL}')"

COPY chronos-forecast.py ./

ENV PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://localhost:'+os.environ.get('PORT','8000')+'/health').status==200 else 1)"

CMD ["python", "chronos-forecast.py"]

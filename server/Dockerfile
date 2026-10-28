# Servidor de Mesa de Rol para hostings con contenedores (o cualquier VPS con Docker).
FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY main.py ./
COPY mesa ./mesa
COPY campanas ./campanas
# Las partidas guardadas, cuentas y el certificado viven en /app/data: móntalo como volumen para no perderlos.
VOLUME ["/app/data"]
ENV MESA_HOST=0.0.0.0 MESA_PUERTO=8765
EXPOSE 8765
RUN useradd --create-home mesa && chown -R mesa /app
USER mesa
CMD ["python", "main.py"]

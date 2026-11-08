# The STUN server for the UDP check on /check/, see README.md. Runs as nobody on 3478 inside the container; publish it
# on the host's UDP 443: docker run -d --name vessel-stun --restart unless-stopped -p 443:3478/udp vessel-stun
FROM python:3.13-alpine
COPY stun.py /app/stun.py
USER nobody
EXPOSE 3478/udp
CMD ["python3", "-u", "/app/stun.py", "--port", "3478"]

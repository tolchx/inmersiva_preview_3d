@echo off
echo Iniciando servidor local para la Sala Inmersiva...
start http://localhost:8000/
python -m http.server 8000
pause

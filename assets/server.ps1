param(
    [int]$Port = 8000,
    [string]$Root = (Get-Location).Path
)

$ErrorActionPreference = 'Stop'
$rootFull = [System.IO.Path]::GetFullPath($Root)
if (-not $rootFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $rootFull += [System.IO.Path]::DirectorySeparatorChar
}

$mimeTypes = @{
    '.html'  = 'text/html; charset=utf-8'
    '.htm'   = 'text/html; charset=utf-8'
    '.js'    = 'application/javascript; charset=utf-8'
    '.mjs'   = 'application/javascript; charset=utf-8'
    '.css'   = 'text/css; charset=utf-8'
    '.json'  = 'application/json; charset=utf-8'
    '.png'   = 'image/png'
    '.jpg'   = 'image/jpeg'
    '.jpeg'  = 'image/jpeg'
    '.gif'   = 'image/gif'
    '.svg'   = 'image/svg+xml'
    '.webp'  = 'image/webp'
    '.ico'   = 'image/x-icon'
    '.mp4'   = 'video/mp4'
    '.webm'  = 'video/webm'
    '.mov'   = 'video/quicktime'
    '.wav'   = 'audio/wav'
    '.mp3'   = 'audio/mpeg'
    '.ogg'   = 'audio/ogg'
    '.wasm'  = 'application/wasm'
    '.woff'  = 'font/woff'
    '.woff2' = 'font/woff2'
    '.ttf'   = 'font/ttf'
}

$listener = New-Object System.Net.HttpListener
$prefix = "http://localhost:$Port/"
$listener.Prefixes.Add($prefix)
$listener.Start()

Write-Host "Servidor PowerShell escuchando en $prefix" -ForegroundColor Green
Write-Host "Presiona Ctrl+C o cierra esta ventana para detenerlo." -ForegroundColor DarkGray

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        try {
            $rawPath = $request.Url.AbsolutePath
            $relPath = [System.Uri]::UnescapeDataString($rawPath).TrimStart('/')
            if ([string]::IsNullOrWhiteSpace($relPath)) {
                $relPath = 'index.html'
            }

            $relPath = $relPath.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
            $candidate = [System.IO.Path]::GetFullPath((Join-Path $rootFull $relPath))

            if (-not $candidate.StartsWith($rootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
                $response.StatusCode = 403
                $bytes = [System.Text.Encoding]::UTF8.GetBytes('403 Forbidden')
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                continue
            }

            if (Test-Path -LiteralPath $candidate -PathType Container) {
                $candidate = Join-Path $candidate 'index.html'
            }

            if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
                $response.StatusCode = 404
                $bytes = [System.Text.Encoding]::UTF8.GetBytes('404 Not Found')
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
                continue
            }

            $ext = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()
            if ($mimeTypes.ContainsKey($ext)) {
                $response.ContentType = $mimeTypes[$ext]
            } else {
                $response.ContentType = 'application/octet-stream'
            }

            $response.Headers['Cache-Control'] = 'no-cache'
            $fileBytes = [System.IO.File]::ReadAllBytes($candidate)
            $response.ContentLength64 = $fileBytes.Length
            $response.StatusCode = 200
            $response.OutputStream.Write($fileBytes, 0, $fileBytes.Length)
        } catch {
            try {
                $response.StatusCode = 500
            } catch {}
        } finally {
            try { $response.OutputStream.Close() } catch {}
        }
    }
} finally {
    if ($listener.IsListening) {
        $listener.Stop()
    }
    $listener.Close()
}

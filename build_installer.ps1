$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$outputExe = Join-Path $projectRoot 'SalaInmersiva_Setup.exe'
$cscPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $cscPath)) {
    $cscPath = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe'
}
if (-not (Test-Path $cscPath)) {
    throw 'No se encontro csc.exe (.NET Framework 4.x).'
}

$tempDir = Join-Path ([System.IO.Path]::GetTempPath()) ("SalaInmersiva_Build_" + [Guid]::NewGuid().ToString('N'))
$stageDir = Join-Path $tempDir 'stage'
$zipPath = Join-Path $tempDir 'SalaInmersiva_app.zip'
$csPath = Join-Path $tempDir 'Installer.cs'

New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

try {
    Copy-Item (Join-Path $projectRoot 'index.html') $stageDir
    Copy-Item (Join-Path $projectRoot 'iniciar_servidor.bat') $stageDir
    if (Test-Path (Join-Path $projectRoot 'README.md')) {
        Copy-Item (Join-Path $projectRoot 'README.md') $stageDir
    }
    Copy-Item (Join-Path $projectRoot 'assets') (Join-Path $stageDir 'assets') -Recurse
    Copy-Item (Join-Path $projectRoot 'pixelmap') (Join-Path $stageDir 'pixelmap') -Recurse

    Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $zipPath -CompressionLevel Optimal

    @'
using System;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;

namespace SalaInmersivaInstaller
{
    internal static class Program
    {
        [STAThread]
        private static int Main(string[] args)
        {
            bool silent = false;
            foreach (string arg in args)
            {
                if (string.Equals(arg, "/silent", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(arg, "/quiet", StringComparison.OrdinalIgnoreCase))
                {
                    silent = true;
                }
            }

            try
            {
                string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
                string installDir = Path.Combine(localAppData, "SalaInmersiva");
                string tempZip = Path.Combine(Path.GetTempPath(), "SalaInmersiva_" + Guid.NewGuid().ToString("N") + ".zip");

                using (Stream res = Assembly.GetExecutingAssembly().GetManifestResourceStream("SalaInmersiva_app.zip"))
                {
                    if (res == null)
                    {
                        throw new InvalidOperationException("No se encontro el paquete incrustado.");
                    }
                    using (FileStream fs = new FileStream(tempZip, FileMode.Create, FileAccess.Write))
                    {
                        res.CopyTo(fs);
                    }
                }

                try
                {
                    if (Directory.Exists(installDir))
                    {
                        Directory.Delete(installDir, true);
                    }
                    Directory.CreateDirectory(installDir);
                    ZipFile.ExtractToDirectory(tempZip, installDir);
                }
                finally
                {
                    if (File.Exists(tempZip))
                    {
                        File.Delete(tempZip);
                    }
                }

                string batPath = Path.Combine(installDir, "iniciar_servidor.bat");
                CreateShortcut(
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Sala Inmersiva 3D.lnk"),
                    batPath,
                    installDir,
                    "Iniciar Sala Inmersiva 3D (Servidor Local)"
                );
                CreateShortcut(
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "Sala Inmersiva 3D.lnk"),
                    batPath,
                    installDir,
                    "Iniciar Sala Inmersiva 3D (Servidor Local)"
                );

                if (!silent)
                {
                    DialogResult res = MessageBox.Show(
                        "Sala Inmersiva 3D se instalo correctamente en:\n" + installDir +
                        "\n\nSe creo un acceso directo en el Escritorio y en el Menu Inicio." +
                        "\n\nDeseas abrir Sala Inmersiva 3D ahora?",
                        "Instalacion completada - Sala Inmersiva 3D",
                        MessageBoxButtons.YesNo,
                        MessageBoxIcon.Information
                    );

                    if (res == DialogResult.Yes)
                    {
                        Process.Start(new ProcessStartInfo
                        {
                            FileName = batPath,
                            WorkingDirectory = installDir,
                            UseShellExecute = true
                        });
                    }
                }

                return 0;
            }
            catch (Exception ex)
            {
                if (!silent)
                {
                    MessageBox.Show(
                        "Error durante la instalacion:\n" + ex.Message,
                        "Error - Sala Inmersiva 3D",
                        MessageBoxButtons.OK,
                        MessageBoxIcon.Error
                    );
                }
                return 1;
            }
        }

        private static void CreateShortcut(string shortcutPath, string targetPath, string workingDir, string description)
        {
            Type shellType = Type.GetTypeFromProgID("WScript.Shell");
            if (shellType == null) return;
            object shell = Activator.CreateInstance(shellType);
            try
            {
                object shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { shortcutPath });
                Type scType = shortcut.GetType();
                scType.InvokeMember("TargetPath", BindingFlags.SetProperty, null, shortcut, new object[] { targetPath });
                scType.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, shortcut, new object[] { workingDir });
                scType.InvokeMember("Description", BindingFlags.SetProperty, null, shortcut, new object[] { description });
                scType.InvokeMember("IconLocation", BindingFlags.SetProperty, null, shortcut, new object[] { Environment.SystemDirectory + "\\SHELL32.dll,220" });
                scType.InvokeMember("Save", BindingFlags.InvokeMethod, null, shortcut, null);
                Marshal.ReleaseComObject(shortcut);
            }
            finally
            {
                Marshal.ReleaseComObject(shell);
            }
        }
    }
}
'@ | Set-Content -Path $csPath -Encoding UTF8

    if (Test-Path $outputExe) {
        Remove-Item -Path $outputExe -Force
    }

    Write-Host "Compilando $outputExe ..." -ForegroundColor Cyan
    & $cscPath /nologo /target:winexe /optimize+ "/out:$outputExe" `
        /r:System.Windows.Forms.dll `
        /r:System.IO.Compression.dll `
        /r:System.IO.Compression.FileSystem.dll `
        "/resource:$zipPath,SalaInmersiva_app.zip" `
        "$csPath"

    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $outputExe)) {
        throw "Error compilando el instalador (codigo $LASTEXITCODE)."
    }

    $sizeMB = [math]::Round((Get-Item $outputExe).Length / 1MB, 2)
    Write-Host "Instalador generado: $outputExe ($sizeMB MB)" -ForegroundColor Green
} finally {
    if (Test-Path $tempDir) {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

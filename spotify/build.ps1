param([string]$SdkPath)

$ErrorActionPreference = 'Stop'
$sdkVersion = '1.0.4314.35'
if (-not $SdkPath) {
    $SdkPath = Join-Path $PSScriptRoot ".sdk-$sdkVersion"
    if (-not (Test-Path -LiteralPath (Join-Path $SdkPath 'lib/net462/Microsoft.Web.WebView2.Core.dll'))) {
        New-Item -ItemType Directory -Path $SdkPath -Force | Out-Null
        $package = Join-Path $SdkPath 'sdk.zip'
        $id = 'microsoft.web.webview2'
        Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/$id/$sdkVersion/$id.$sdkVersion.nupkg" -OutFile $package
        Expand-Archive -LiteralPath $package -DestinationPath $SdkPath -Force
    }
}
$SdkPath = (Resolve-Path -LiteralPath $SdkPath).Path
$output = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../assets/spotify-host'))
New-Item -ItemType Directory -Path $output -Force | Out-Null
$core = Join-Path $SdkPath 'lib/net462/Microsoft.Web.WebView2.Core.dll'
$forms = Join-Path $SdkPath 'lib/net462/Microsoft.Web.WebView2.WinForms.dll'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$compilerArgs = @(
    '/nologo', '/target:exe', '/platform:x64', '/optimize+', '/codepage:65001',
    '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll',
    "/reference:$core", "/reference:$forms", "/win32manifest:$(Join-Path $PSScriptRoot 'SpotifyHost.manifest')",
    "/out:$(Join-Path $output 'SpotifyHost.exe')",
    (Join-Path $PSScriptRoot 'SpotifyHost.cs'), (Join-Path $PSScriptRoot 'SpotifyAdBlock.cs')
)
& $compiler @compilerArgs
if ($LASTEXITCODE -ne 0) { throw 'SpotifyHost.exe compilation failed.' }
Copy-Item -LiteralPath $core, $forms, (Join-Path $SdkPath 'runtimes/win-x64/native/WebView2Loader.dll') -Destination $output
Copy-Item -LiteralPath (Join-Path $SdkPath 'LICENSE.txt') -Destination (Join-Path $output 'LICENSE-WebView2.txt')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'youtube.png'), (Join-Path $PSScriptRoot 'spotify.png'), (Join-Path $PSScriptRoot 'spotify-switch.js') -Destination $output

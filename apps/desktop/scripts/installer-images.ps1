# Draws the installer's images from the logo: three bars, no other detail (HANDOFF 7).
# NSIS wants 24-bit BMP files at these exact sizes.
Add-Type -AssemblyName System.Drawing
$out = Join-Path $PSScriptRoot "..\src-tauri\icons"

function Draw($file, $width, $height, $x, $y, $scale) {
    $bmp = New-Object System.Drawing.Bitmap($width, $height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.Clear([System.Drawing.ColorTranslator]::FromHtml("#101412"))
    foreach ($bar in @(@(0, 20, "#F5B83D"), @(7, 14, "#5B8DEF"), @(14, 8, "#E8743B"))) {
        $brush = New-Object System.Drawing.SolidBrush([System.Drawing.ColorTranslator]::FromHtml($bar[2]))
        # RTL product: the bars hang from the right, like the logo in the app's rail.
        $g.FillRectangle($brush, $x, ($y + $bar[0] * $scale), ($bar[1] * $scale), (5 * $scale))
        $brush.Dispose()
    }
    $g.Dispose()
    $bmp.Save((Join-Path $out $file), [System.Drawing.Imaging.ImageFormat]::Bmp)
    $bmp.Dispose()
}

Draw "installer-sidebar.bmp" 164 314 32 120 5
Draw "installer-header.bmp" 150 57 108 14 1.5

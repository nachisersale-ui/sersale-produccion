# Achica las fotos de producto del catalogo mayorista para usarlas en Presupuestos.
#
#   powershell -File tools\miniaturas-catalogo.ps1 -Origen "<carpeta>\1 - Catalogo mayorista\catalogo"
#
# Toma img\p-<articulo>.jpg (700x700) y deja src\assets\productos\p-<articulo>.jpg
# en 220x220, livianas: van dentro del PDF del presupuesto y se guardan en el telefono.
param([Parameter(Mandatory = $true)][string]$Origen, [int]$Lado = 220, [long]$Calidad = 78)
Add-Type -AssemblyName System.Drawing
$destino = Join-Path (Split-Path $PSScriptRoot -Parent) "src\assets\productos"
New-Item -ItemType Directory -Force $destino | Out-Null
Get-ChildItem $destino -Filter "p-*.jpg" | Remove-Item -Force
$codec = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), $Calidad
$n = 0; $bytes = 0
Get-ChildItem (Join-Path $Origen "img") -Filter "p-*.jpg" | ForEach-Object {
  $img = [System.Drawing.Image]::FromFile($_.FullName)
  $bmp = New-Object System.Drawing.Bitmap $Lado, $Lado
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.Clear([System.Drawing.Color]::White)
  $g.InterpolationMode = 'HighQualityBicubic'
  # Se encuadra al centro por si alguna foto no es cuadrada.
  $corte = [Math]::Min($img.Width, $img.Height)
  $src = New-Object System.Drawing.Rectangle ([int](($img.Width - $corte) / 2)), ([int](($img.Height - $corte) / 2)), $corte, $corte
  $dst = New-Object System.Drawing.Rectangle 0, 0, $Lado, $Lado
  $g.DrawImage($img, $dst, $src, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose(); $img.Dispose()
  $salida = Join-Path $destino $_.Name
  $bmp.Save($salida, $codec, $ep); $bmp.Dispose()
  $n++; $bytes += (Get-Item $salida).Length
}
"miniaturas: $n fotos, $([Math]::Round($bytes / 1KB)) KB en total"

# Generates one WAV per narration line with the built-in Windows voice. Usage: tts.ps1 <script.json> <outdir>
param([string]$Script, [string]$Out)
Add-Type -AssemblyName System.Speech
$lines = Get-Content $Script -Raw -Encoding UTF8 | ConvertFrom-Json
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice('Microsoft Zira Desktop')
$s.Rate = 1
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($l in $lines) {
  $say = $l.say -replace 'u1 unified', 'U one unified' -replace 'ZEC', 'Zed E C'
  $s.SetOutputToWaveFile((Join-Path $Out ($l.id + '.wav')), $fmt)
  $s.Speak($say)
}
$s.SetOutputToNull()

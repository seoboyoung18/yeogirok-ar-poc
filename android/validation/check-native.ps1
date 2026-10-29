param(
    [string]$CacheRoot = "$env:USERPROFILE\.gradle\caches\modules-2\files-2.1",
    [string]$SdkRoot = "$env:LOCALAPPDATA\Android\Sdk"
)

# Offline source compilation + JVM policy checks, NOT a Gradle/APK/device test.
$ErrorActionPreference = 'Stop'
$androidRoot = Split-Path $PSScriptRoot -Parent
$out = Join-Path $androidRoot 'build\native-validation'
New-Item -ItemType Directory -Force -Path $out | Out-Null

function CachedFile([string]$relative, [string]$name) {
    $match = Get-ChildItem (Join-Path $CacheRoot $relative) -Recurse -Filter $name -File |
        Select-Object -First 1
    if ($null -eq $match) { throw "Required cached dependency missing: $relative/$name" }
    return $match.FullName
}

$stdlib = CachedFile 'org.jetbrains.kotlin\kotlin-stdlib\2.1.20' 'kotlin-stdlib-2.1.20.jar'
$compiler = @(
    (CachedFile 'org.jetbrains.kotlin\kotlin-compiler-embeddable\2.1.20' 'kotlin-compiler-embeddable-2.1.20.jar'),
    $stdlib,
    (CachedFile 'org.jetbrains.kotlin\kotlin-script-runtime\2.1.20' 'kotlin-script-runtime-2.1.20.jar'),
    (CachedFile 'org.jetbrains.kotlin\kotlin-reflect\1.6.10' 'kotlin-reflect-1.6.10.jar'),
    (CachedFile 'org.jetbrains.kotlin\kotlin-daemon-embeddable\2.1.20' 'kotlin-daemon-embeddable-2.1.20.jar'),
    (CachedFile 'org.jetbrains.intellij.deps\trove4j\1.0.20200330' 'trove4j-1.0.20200330.jar'),
    (CachedFile 'org.jetbrains.kotlinx\kotlinx-coroutines-core-jvm\1.8.0' 'kotlinx-coroutines-core-jvm-1.8.0.jar'),
    (CachedFile 'org.jetbrains\annotations\13.0' 'annotations-13.0.jar')
) -join ';'
$aar = CachedFile 'com.google.ar\core\1.57.0' 'core-1.57.0.aar'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($aar)
$arcore = Join-Path $out 'arcore-1.57.0-classes.jar'
try {
    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($archive.GetEntry('classes.jar'), $arcore, $true)
} finally { $archive.Dispose() }

# Also type-check the changed map and RN bridge against the project's cached SDKs.
# These are isolated source checks, not Gradle dependency-resolution assertions.
$extraJars = foreach ($dependency in @(
    @('com.kakao.maps.open\android\2.15.2', 'android-2.15.2.aar'),
    @('com.facebook.react\react-android\0.86.0', 'react-android-0.86.0-debug.aar'),
    @('com.google.android.gms\play-services-location\21.0.1', 'play-services-location-21.0.1.aar'),
    @('com.google.android.gms\play-services-tasks\18.0.2', 'play-services-tasks-18.0.2.aar'),
    @('com.google.android.gms\play-services-basement\18.1.0', 'play-services-basement-18.1.0.aar'),
    @('com.google.android.gms\play-services-base\18.1.0', 'play-services-base-18.1.0.aar')
)) {
    $cachedAar = CachedFile $dependency[0] $dependency[1]
    $jar = Join-Path $out ($dependency[1] -replace '\.aar$', '-classes.jar')
    $zip = [System.IO.Compression.ZipFile]::OpenRead($cachedAar)
    try { [System.IO.Compression.ZipFileExtensions]::ExtractToFile($zip.GetEntry('classes.jar'), $jar, $true) }
    finally { $zip.Dispose() }
    $jar
}

$androidJar = Join-Path $SdkRoot 'platforms\android-36\android.jar'
if (!(Test-Path -LiteralPath $androidJar)) { throw 'Android API 36 platform is required.' }
$sourceRoot = Join-Path $androidRoot 'app\src\main\java'
$geo = Join-Path $sourceRoot 'com\yeogirokarpoc\geo'
$sources = @('GeoArActivity.kt', 'GeoRecord.kt', 'PinProjection.kt', 'GeoTrackingPolicy.kt',
    'ArExperimentPolicy.kt', 'CloudRecord.kt', 'CloudAnchorExperiment.kt',
    'GeoMapActivity.kt', 'GeoValidationModule.kt', 'CloudNavigation.kt', 'NavigationPolicy.kt', 'DirectionArrowView.kt',
    'LocalTipStore.kt', 'TipExperienceModule.kt', 'TipDetailSheet.kt', 'PinTapPolicy.kt') |
    ForEach-Object { Join-Path $geo $_ }
# Existing Java renderer sources are supplied for Kotlin symbol resolution.
$javaSources = Get-ChildItem (Join-Path $sourceRoot 'com\google') -Recurse -Filter *.java |
    ForEach-Object FullName
$classes = Join-Path $out 'classes'
& java -cp $compiler org.jetbrains.kotlin.cli.jvm.K2JVMCompiler -no-stdlib -no-reflect `
    -jvm-target 17 -classpath ( (@($stdlib, $androidJar, $arcore) + $extraJars) -join ';') -d $classes `
    @sources @javaSources (Join-Path $PSScriptRoot 'GeoTrackingPolicyCheck.kt') `
    (Join-Path $PSScriptRoot 'ArExperimentPolicyCheck.kt') (Join-Path $PSScriptRoot 'NavigationPolicyCheck.kt') `
    (Join-Path $PSScriptRoot 'PinTapPolicyCheck.kt')
if ($LASTEXITCODE -ne 0) { throw 'Native source compilation failed.' }
Write-Output 'Native AR/map/RN bridge source compilation passed (Kotlin 2.1.20 / ARCore 1.57.0).'
& java -cp "$classes;$stdlib;$arcore" com.yeogirokarpoc.geo.GeoTrackingPolicyCheckKt
if ($LASTEXITCODE -ne 0) { throw 'Tracking policy checks failed.' }
& java -cp "$classes;$stdlib;$arcore" com.yeogirokarpoc.geo.ArExperimentPolicyCheckKt
if ($LASTEXITCODE -ne 0) { throw 'AR experiment policy checks failed.' }
& java -cp "$classes;$stdlib;$arcore" com.yeogirokarpoc.geo.NavigationPolicyCheckKt
if ($LASTEXITCODE -ne 0) { throw 'Navigation policy checks failed.' }
& java -cp "$classes;$stdlib;$arcore" com.yeogirokarpoc.geo.PinTapPolicyCheckKt
if ($LASTEXITCODE -ne 0) { throw 'Pin tap policy checks failed.' }

# 여기록 AR PoC 검증

## 카메라 영상 위 방향 화살표 추가

기존 하단 텍스트 방향 안내에 더해 탐색 AR 화면의 왼쪽 중앙에 큰 회전 화살표를 추가했다. 우상단 미니맵은 유지한다. 하늘색 `대략적인 방향`은 지도 탐색 목표 방위이고, 주황색 `복원된 팁 방향`은 현재 카메라와 복원된 앵커의 상대 방향이다. 화면 위쪽 화살표는 정면, 좌우 화살표는 회전 방향, 아래쪽 화살표와 `뒤쪽` 문구는 뒤돌아보라는 뜻이다. 바닥에 고정된 이동 경로나 계단 안내는 아니다.

위치·방향 측정이 부정확하거나 오래되었을 때, 탐색 목표와의 거리가 현재 위치 불확실성에 묻힐 때, AR 추적을 잃었거나 프레임 갱신이 중단됐을 때는 해당 화살표를 숨긴다. 복원된 앵커가 바로 위·아래라 수평 방향이 없으면 지도 방위로 대체하지 않는다. 화면 일시정지 시 화살표도 지운다.

변경: 새 `DirectionArrowView.kt`, `NavigationPolicy.kt`, `CloudNavigation.kt`, `GeoArActivity.kt`, 네이티브 검증 스크립트와 방향 정책 검사. 설치 후 `미니맵으로 찾기 · AR 방향 안내`에서 카메라를 좌우로 돌리며 화살표와 실제 핀 방향을 비교한다. 원래 `복원·비교` 화면은 기존 측정 UI를 유지한다. Kotlin 소스 컴파일과 정책 검사 77개(기존 44개 + 방향 33개) 통과. APK·실기기 시각 검증은 별도로 필요하다.

## Cloud 팁 1개: 탐색 위치 연결 → 우상단 미니맵 → AR 방향 안내

`poc/arcore-basic`에서 기존 Cloud 저장·복원 및 터치·드래그 구현을 유지하고 단일 팁 탐색을 추가했다. 기존 미커밋 파일을 초기화하지 않았으며 의존성 버전을 변경하지 않았다.

### 이번 구현 범위

- Cloud JSON에 선택 필드 `discoveryLocation`을 추가했다. `latitude`, `longitude`, `source: MAP_SELECTED`, `uncertaintyMeters: null`, `capturedAt`을 저장한다. 기존 JSON은 계속 읽을 수 있다. `geospatial`은 여전히 null이며 원래 앵커 ID·Pose는 바꾸지 않는다.
- 기존 카카오 지도 화면에서 현재 위치로 지도를 이동한 뒤 사용자가 탐색 위치를 직접 선택한다. 현재 위치 갱신 자체로 목표 좌표를 저장하지 않는다. 첫 지도 중심은 뷰의 기본값이며 저장 대상이 아니다. 지도 위치는 건물·입구 등 근처 안내용이고 측량 기준점이 아니다.
- Cloud 결과 화면의 `미니맵으로 찾기 · AR 방향 안내`가 새 탐색 모드로 진입한다. 기존 `이 Cloud Anchor 복원·비교`도 유지한다.
- 우상단 미니맵: 북쪽 고정, 주황색 탐색 목표, 파란색 현재 위치와 카메라 방향. 두 지점을 볼 수 있도록 약 2초마다 범위를 조정하고 최대 확대를 제한한다. 목표 좌표의 오차 미상 및 현재 위치 추정 정확도를 표시한다.
- 복원 전 안내: 현재 위치에서 탐색 목표의 방위를 구하고 후면 카메라 광축의 수평 방위와 비교한다. 이동 방향인 GPS bearing을 사용하지 않는다. 회전 벡터의 기기 -Z 축을 세계 동·북 좌표로 투영하고 지자기 편각을 반영한다. 방향 센서 품질이 낮거나 카메라가 수직에 가까우면 화살표를 표시하지 않는다.
- 실험용 조건: 현재 위치 10초 이내·추정 정확도 25m 이내, 방향 표본 2초 이내·센서 정확도 MEDIUM 이상. 회전 벡터에 방위 오차 값이 제공되면 25도 이하도 확인한다. 이 숫자는 제품 정책이나 서버 접근 권한 조건이 아니다.
- 유효한 현재 위치에서 탐색 목표까지 50m 이내면 Cloud 복원을 시도한다. 실내의 위치 측정 실패·권한 거절에도 `현장 도착 · 주변 인식 시작`으로 같은 앵커 복원을 시도할 수 있다. 자동 반복 요청은 하지 않으며 실패 시 `복원 재시도`를 사용한다.
- 복원 후에는 카메라/앵커가 모두 TRACKING일 때 AR 세션의 상대 방향·3D 직선거리를 표시한다. 추적을 잃으면 핀과 정밀 안내를 숨기고 회복을 기다린다. 안내는 통행 가능한 보행 경로를 계산하는 기능이 아니다.
- 탐색 모드의 `복원 결과 기록`은 별도 기준점 터치 없이 RESOLVE 시간·기기·세션을 저장한다. 이전 세션의 참고 오차는 제거한다. 지도의 탐색 위치와 앵커 위치를 빼서 복원 오차로 기록하지 않는다.
- 화면 일시정지 시 위치 요청·방향 센서·안내 갱신을 중지하고 오래된 표시를 지운다. 지도 실패가 Cloud 복원 결과를 대신하지 않는다. `NAV_STAGE`, `MINIMAP_READY` 등 진단 로그에 좌표·키·앵커 ID는 남기지 않는다.

### 변경 파일

- `CloudRecord.kt`, `cloudAnchors.ts`: 기존 레코드와 호환되는 탐색 위치 검증.
- `GeoMapActivity.kt`, `GeoValidationModule.kt`, `CloudValidationPanel.tsx`: 탐색 좌표 선택·로컬 저장·JSON 공유·화면 연결.
- `GeoArActivity.kt`, 새 `CloudNavigation.kt`, 새 `NavigationPolicy.kt`: 미니맵, 위치·방향 센서, 안내 상태 전환, 탐색 모드 결과 기록.
- `android/validation/check-native.ps1`, 새 `NavigationPolicyCheck.kt`, `__tests__/cloudAnchors.test.ts`: 네이티브 컴파일 및 회귀 검사.

### 실기기 확인 순서

1. 일반 PowerShell에서 저장소 폴더로 이동하고 `.\android\validation\check-device.ps1`로 빌드·재설치한다. 네이티브 코드 변경이므로 `-Mode Launch`만으로는 반영되지 않는다.
2. 기존 Cloud 결과를 열거나 JSON을 불러온다. 예상 수명이 지난 앵커라면 새로 저장한다.
3. `1. 탐색용 지도 위치 연결` → `내 현재 위치 갱신` → 실제 장소를 지도에서 터치 → `사용` → `탐색 위치를 연결하고 돌아가기`.
4. `2. 미니맵으로 찾기 · AR 방향 안내`를 연다. 우상단 지도에 주황색 목표가 표시되는지, 위치가 유효하면 파란색 현재 위치가 보이는지 확인한다.
5. 위치·방향이 유효한 장소에서 좌우로 돌아 대략적인 방향 안내를 확인한다. 정밀 AR 방향과 지도 안내를 혼동하지 않는다. 실내에서 위치가 안 잡히면 `현장 도착 · 주변 인식 시작`을 누른다.
6. 복원 성공 후 기존 위치의 주황 핀과 상대 방향·거리를 확인한다. 좌우·뒤쪽, 카메라를 가렸다가 복구, 화면을 나갔다 재진입, 위치 권한 거절도 확인한다.
7. `복원 결과 기록` 후 JSON의 `operation.type=RESOLVE`와 `discoveryLocation` 보존 여부를 확인한다. 다른 기기에서는 이 JSON 전체를 공유한다. 실제 오차는 물리 기준점으로 별도 측정한다.
8. 문제가 있으면 `.\android\validation\check-device.ps1 -Mode Capture`로 새 로그를 수집한다.

### 검증 상태와 남은 범위

- Kotlin 소스 컴파일 및 정책 검사 67개, Jest 42개, TypeScript, 변경 TS/TSX ESLint 검사 통과. APK 빌드·새 버전 설치·미니맵/AR 동시 렌더링 실기기 결과는 아직 확인하지 않았다.
- 아직 구현하지 않은 범위: 동일 세션에서 팁 Pose의 Geospatial 좌표를 자동 취득해 Cloud 레코드와 결합, 서버 주변 팁 검색/접근 정책, 여러 팁 선택, 실내 층·통행 경로, 장기 앵커 관리. 현재는 사용자가 지도에서 확인한 위치를 연결하는 단일 팁 PoC다.
- 사용자 보고: 이전 Cloud 복원은 1초 이내, 육안으로 위치 차이가 보이지 않았음. 이번 미니맵 기능의 실기기 성공이나 측정 오차 0cm·기기 간 성공으로 확대 해석하지 않는다.

참고: [Android SensorManager](https://developer.android.com/reference/android/hardware/SensorManager), [GeomagneticField](https://developer.android.com/reference/android/hardware/GeomagneticField), [Kakao CameraUpdateFactory](https://apis.map.kakao.com/android_v2/reference/com/kakao/vectormap/camera/CameraUpdateFactory.html). 실제 컴파일에는 저장소가 사용하던 ARCore 1.57.0 / Kakao 2.15.2 / Location 21.0.1을 사용했다.

## 수치 비교 재개: 현재 품질로 시험 저장

작업 목표는 배치·복원 결과를 수치로 비교하는 것이다. `GOOD`만 허용한 앱 자체 조건 때문에 host 요청을 시작할 수 없어 인증·서버 응답·복원 결과 비교가 모두 막혔다. 지도 통합으로 작업을 옮기지 않고 이 차단 구간을 먼저 실험 가능하게 보완했다.

- 새 Cloud 배치 화면에 기본 해제된 `비교 실험: 현재 품질로 저장 허용` 체크박스를 추가했다. 선택하면 버튼 이름이 `시험 저장`으로 바뀐다. 기존 핀은 유지된다.
- 기본 모드는 기존 GOOD 1초 조건을 유지한다. 비교 모드는 현재 측정된 GOOD/SUFFICIENT/INSUFFICIENT를 허용한다. 유효한 Hit, 카메라·앵커 TRACKING, 드래그 종료, 유효한 현재 품질 측정은 여전히 필요하다. 측정 오류나 추적 소실을 우회하지 않는다.
- 요청 시 실제 품질과 `qualityPolicy`를 고정해서 기록한다. `DIAGNOSTIC_CURRENT_QUALITY`는 비교 저장, `GOOD_STABLE`은 기존 저장이다. 낮은 품질을 GOOD으로 기록하지 않는다. 새 필드가 없는 이전 GOOD JSON은 기존 정책으로 읽는다. 낮은 품질 JSON에는 비교 정책 표시가 반드시 있어야 한다.
- 서버가 낮은 품질 요청을 받아 저장할지는 아직 검증하지 않았다. host 성공 시 Cloud ID로 복원 실험을 진행한다. 실패·시간 초과·취소도 로그에 소요 시간을 남긴다. 해당 시도는 성공률 분모에서 제외하지 않는다.
- 품질 등급, 실제 Hit 종류, Depth Hit 허용 여부, host/resolve 소요 시간, 수평·수직 참고 차이를 함께 비교한다. 같은 물리적 기준점과 기기 조합에서 반복해야 한다. AR 기준점 비교는 측량 정답값이 아니며 `crossDeviceVerified=false`와 `groundTruth=false`를 유지한다. 중앙 조준점 비교 UI 및 자동 집계표는 아직 구현되지 않았다.

변경 파일: `GeoArActivity.kt`, `CloudAnchorExperiment.kt`, `CloudRecord.kt`, `ArExperimentPolicy.kt`, `CloudValidationPanel.tsx`, `cloudAnchors.ts`, 관련 Kotlin/TS 검사. 라이브러리 버전은 바꾸지 않았다.

검증: 변경 Kotlin 소스 컴파일, Kotlin 정책 검사 44개, Jest 33개, TypeScript 및 변경 TS/TSX ESLint 검사 통과. 새로운 APK의 기기 설치·host 요청 결과는 아직 확인하지 못했다.

새 코드 설치: `.\android\validation\check-device.ps1` → 기존 장소에서 핀 배치 → `현재 품질로 저장 허용` 체크 → `시험 저장`. 결과는 `.\android\validation\check-device.ps1 -Mode Capture`로 수집한다. 이번 변경의 실제 host/resolve 성공은 기기 재실행 후 확인해야 한다.

## 2026-10-29 14:46 Cloud 저장 비활성 진단

`validation-records/device-20261029-144601-417/app-runtime.log`에서 다음을 확인했다.

| 관찰 | 로그 근거 |
|---|---|
| Cloud 세션 생성·설정 | 14:39:03 `AR_SESSION_CREATE_OK`, `AR_CONFIG cloud=true depthSupported=true` |
| 실제 핀 추적 | 14:39:29, 14:40:38 `camera=TRACKING anchor=TRACKING` |
| 특징 품질 결과 | 두 차례 `FEATURE_QUALITY=INSUFFICIENT`; SUFFICIENT/GOOD 전환 기록 없음 |
| 추적 중단 | 배치 후 카메라·앵커가 함께 PAUSED로 전환된 기록 5회, 일부 구간 이후 회복 |
| 저장 요청 | `HOST_STARTED` 기록 없음. 이 수집 구간에서 호스팅 성공·실패 응답도 없음 |

따라서 이 로그에서 확인된 직접적인 저장 차단 요인은 GOOD 조건 미충족이다. API 키나 네트워크 오류가 확인된 결과가 아니며, 호스팅을 시작하지 않았으므로 인증 정상 여부도 판정할 수 없다. 품질 결과 전환만 기록하던 기존 로그로는 배치 무효화·드래그 때문에 평가가 중단됐는지와 INSUFFICIENT가 계속 재측정됐는지를 구분할 수 없다. 주변의 실제 조명·무늬·반사 상태나 추적 중단 원인도 이 로그만으로 확정하지 않는다.

종료 이력에 있는 이전 시간의 LOW_MEMORY, 재설치에 따른 PACKAGE_UPDATED, 실행 스크립트의 FORCE_STOP을 이번 Cloud 화면의 크래시로 해석하지 않았다.

이번 진단 보완:

- `GeoArActivity.kt`: 카메라 화면과 상태 첫 부분에 저장 차단 이유를 표시한다. 핀 없음, 마지막 Hit 실패, 카메라/앵커 추적 대기, 드래그 중, 품질 측정 오류, 특징 부족, GOOD 유지 중을 구분한다.
- `CloudAnchorExperiment.kt`: 품질 평가를 중단하면 이전 값을 현재 측정값으로 표시하지 않는다. 예외를 단순한 ‘측정 대기’로 숨기지 않고 예외 클래스 이름을 표시·기록한다. 메시지 원문, API 키, 앵커 ID, 좌표는 로그에 넣지 않는다.
- `ArExperimentPolicy.kt`: 실제 GOOD 샘플로 관측한 유지 시간을 표시용으로 제공한다. 기존 GOOD 1초·750ms 관측 공백 초기화 규칙은 유지한다.
- `HOST_GATE` 로그는 차단 이유, 배치 유효성, 드래그 상태, 품질 유효성, 버튼 활성 여부와 평가 호출 횟수를 상태 변경 시 및 5초마다 남긴다. `TRACKING` 로그에는 ARCore의 추적 실패 원인을 추가한다.

변경 Kotlin 소스 컴파일과 기존 정책 검사 37개가 통과했다. 새 진단 화면의 APK 빌드·기기 실행은 아직 확인하지 못했다. 이전에 성공한 APK 설치 결과를 이번 변경의 설치 결과로 취급하지 않는다.

새 진단 코드 설치에는 `Launch` 대신 기본 Prepare가 필요하다.

```powershell
.\android\validation\check-device.ps1
```

같은 현상을 재현한 뒤 카메라 위의 저장 상태 문구를 확인하고 `-Mode Capture`로 수집한다. `QUALITY_INSUFFICIENT`와 함께 `samples`가 계속 증가하면 품질 평가 자체는 실행되는 상태다. `LAST_HIT_INVALID`, `DRAGGING`, `CAMERA_NOT_TRACKING`, `QUALITY_ERROR`가 나오면 해당 원인을 우선 조사한다. 실제 공간 변경 여부와 촬영 동작을 함께 비교하기 전까지 저품질의 근본 원인이나 기기 간 복원 성공을 단정하지 않는다.

## 2026-10-29 실기기 빌드·설치 성공 / Metro 준비 확인 보완

사용자의 일반 PowerShell 실행 결과를 프로젝트의 `validation-records/device-20261029-142353-046`에서 확인했다.

| 단계 | 확인 결과 |
|---|---|
| 실기기 | SM-S916N, arm64-v8a 인식 |
| Gradle | `BUILD SUCCESSFUL in 34s`, 76개 작업 중 8개 실행 |
| 설치 | `Performing Streamed Install` → `Success` |
| APK | 2026-10-29 14:24:28 생성. SHA256 `6B735D33E38B83B3D5EBB9C916890310CC7A540C72BC44F48C19E1AEEFF9D9E3` |
| Metro 프로세스 | stdout에 `Dev server ready`, stderr는 비어 있음 |
| 검증 스크립트 | 준비 확인 실패로 앱 시작 전에 중단 (`launched=false`) |
| AR 카메라·Cloud 저장/복원 | 이 실행 결과만으로는 미검증 |

이 결과는 앞 절차에서 에이전트 실행 환경의 데몬 연결이 실패했던 것과 구분한다. 사용자의 일반 PowerShell에서는 빌드와 설치가 성공했다. Kotlin/Gradle deprecated 경고는 빌드 실패가 아니다.

설치된 RN CLI의 `/status`는 Content-Type을 지정하지 않는다. HTTP 본문이 `byte[]`일 때 기존 `.Content -match ...` 검사가 false가 되는 경우를 재현했다. 실패 당시 스크립트가 HTTP 응답 타입/오류를 저장하지 않았으므로 이것이 사용자 실행의 유일한 원인이었는지는 아직 확정하지 않았다.

- `metro-response.ps1`: 문자열과 UTF-8 바이트 배열을 모두 처리하고 HTTP 상태·본문·`X-React-Native-Project-Root` 헤더로 서버와 프로젝트를 확인한다.
- `check-device.ps1`: 상태 확인 오류를 기록한다. 다른 프로젝트의 Metro로 판별되면 새 서버를 중복 시작하지 않고 멈춘다. 번들 검사에도 동일한 본문 변환을 사용한다.
- `Launch` 모드: 재빌드·재설치 없이 진행하되, 기기의 base APK SHA256이 로컬 빌드와 같을 때만 Metro 확인·ADB reverse·앱 실행을 진행한다. 실행하지 않은 빌드/설치 단계는 실패가 아닌 null로 기록한다.
- `check-metro-response.ps1`: 바이트 배열 회귀 재현, 문자열, 프로젝트 경로 인코딩/대소문자, 다른 프로젝트, 헤더 누락, HTTP 실패, 잘못된 본문, 번들 변환 11개 검사가 PowerShell 7.6.5에서 통과했다. Windows PowerShell 5.1 추가 실행 검사는 이 환경의 AuthorizationManager 오류로 실행되지 않았다. 수정 스크립트 문법 검사는 통과했다. 앱 소스/의존성은 이번 수정에서 바꾸지 않았다.

기존 일반 PowerShell에서 아래 명령으로 이어간다.

```powershell
.\android\validation\check-device.ps1 -Mode Launch
```

폰에서 Cloud 저장·복원 조작 후 `-Mode Capture`로 로그를 수집한다.

후속 확인: `device-20261029-143359-710`에서 Prepare의 빌드·설치·새 Cloud 번들 확인·앱 실행이 모두 성공했다. `device-20261029-143831-916`에서도 Launch의 `installedApkMatchesLocal=true`, `cloudBundleConfirmed=true`, `launched=true`를 확인했고, 사용자가 실제 앱이 열렸다고 보고했다. Metro 준비 확인 수정 이후의 시작 경로는 실기기에서 확인됐다. 아직 Cloud host/resolve와 실제 위치 정확도 결과는 없으며 `physicalAccuracyVerified=false`를 유지한다. 첫 현장 단계는 Depth Hit를 끈 평면 기준 배치·GOOD 품질 유지·Cloud 저장이다.

## 실기기 연결 후 재시도와 실행 도구

사용자가 기기를 연결한 후 다시 시도했지만, 이 실행 환경의 `adb devices -l`은 기기 목록을 반환하기 전에 `could not read ok from ADB Server / cannot connect to daemon`으로 실패했다. `adb version` 자체는 정상 실행됐다. USB 연결 불량이나 사용자 인증 거부로 확인된 상태는 아니다. Gradle `:app:assembleDebug` 재시도도 데몬 연결 실패로 종료됐다. 기존 APK 시각은 2026-10-29 11:12:42이며 새 Cloud 코드의 검증 결과로 사용할 수 없다.

`android/validation/check-device.ps1`을 추가했다. 일반 PowerShell에서 다음과 같이 실행한다.

```powershell
cd C:\Users\SSAFY\projects\yeogirok-ar-poc
.\android\validation\check-device.ps1
```

이 명령은 인증된 연결 기기와 ABI를 확인하고, 기존 고정 의존성으로 오프라인 Gradle 빌드가 성공한 경우에만 APK를 `install -r`로 설치한다. 앱 데이터는 삭제하지 않는다. Metro를 확인하거나 숨김 프로세스로 시작하고, 번들에 새 Cloud 실험 모듈이 포함되는지 확인한 다음 이 앱만 재시작한다. 기존의 다른 Metro 서버를 강제로 종료하지 않는다. 연결 기기가 여럿이면 `-Serial`로 선택한다. SDK 위치가 다르면 `-SdkRoot`를 지정한다. 오프라인 의존성이 없으면 해당 오류에서 멈추며 임의 업데이트하지 않는다.

폰에서 홈 → Cloud Anchor 복원 실험 → 새 Cloud Anchor 배치 → 터치/드래그 → 주변 여러 각도 촬영 → GOOD 유지 → Cloud 저장 순서로 확인한다. 품질은 영상 입력이 있어야 측정할 수 있어 원격 버튼 입력만으로 검증할 수 없다. 같은 폰에서 앱을 재시작해 resolve하는 것은 세션 간 복원 검사이고, 다른 사용자·다른 기기의 동일 위치 복원을 입증하지 않는다.

조작 후 로그는 다음 명령으로 수집한다.

```powershell
.\android\validation\check-device.ps1 -Mode Capture
```

결과는 Git에서 제외된 `validation-records/device-*`에 저장된다. APK SHA256, 빌드/설치/Activity 시작 여부, 대상 앱 UID로 제한한 로그와 종료 이력을 수집한다. 이전 Prepare가 있으면 그 기기 시각부터 로그를 읽는다. `HOST_SUCCESS`/`RESOLVE_SUCCESS`와 실제 물리적 정확도는 구분하며, 자동으로 합격 판정하지 않는다. 로컬에 설정된 두 API 키는 진단 출력에서 가린다.

진단을 위해 `YeogirokCloud` 태그에 특징 품질 변화, host/resolve 시작·성공·실패·취소, 카메라/앵커 추적 상태와 결과 반환을 추가했다. 공유 앵커 ID·좌표·API 키는 기록하지 않는다. 새 진단 코드의 Kotlin 소스 컴파일 및 기존 정책 검사 37개, PowerShell 스크립트 문법 검사는 통과했다. 스크립트의 실제 빌드·설치·실행 단계는 이 환경에서 검증되지 않았다.

## 2026-10-29 Cloud Anchor·Depth 비교 실험 추가 (최신 상태)

기존 `poc/arcore-basic`의 Kotlin ARCore 세션·렌더러·터치/드래그를 재사용했다. 의존성 버전, 기존 로컬 설정과 검증 JSON은 유지했다. 아래 이전 절은 당시 상태를 남긴 이력이며, Cloud Anchor 미구현이라는 설명은 이번 절로 갱신된다.

### 선택한 경로와 실험 범위

서비스 목표는 **카카오 지도에서 근처 탐색 → 카메라로 주변 인식 → 공유 앵커 복원 → 실제 앵커 방향 안내**다. 이번에 전체 서비스 흐름을 연결한 것은 아니다. 기존 지리 좌표 화면과 새 Cloud Anchor 화면을 독립적으로 비교할 수 있게 했다.

| 영역 | 이번 구현 | 아직 남은 검증·개발 |
|---|---|---|
| 배치 | 기존 터치/드래그 유지. 평면만 / Depth Hit도 허용 선택. 실제 Hit 종류 기록 | 중앙 조준점 비교 UI, 환경별 오차 실측 |
| 지리 좌표 | 기존 최종 Anchor Pose → Earth 변환 유지. 팁과 카메라 위치 분리 | VPS 가용성 확인, 위치·방향 품질 게이트, 지도와 Cloud 레코드 결합 |
| Cloud 작성 | GOOD 품질 지속 후 비동기 host, 성공 ID만 저장 | 실기기 호스팅, 장기 키리스 인증 |
| Cloud 복원 | JSON 전달 → resolve → TRACKING 시 표시. 같은 세션 기준점으로 참고 차이 기록 | 실제 다른 기기의 물리적 복원 정확도, 시간·조명 변화 |
| 방향 | 디스플레이 방향을 반영한 카메라 Pose와 앵커의 상대 방향 | 지도 방위·자기장 보정·미니맵 연동 |
| 현재 위치 | 오래되거나 정확도 정보 없는 측정 거절, 10초 후 지도에서 현재 위치 제거 | 서버의 50m 탐색·10m 상세 접근 정책 |

Cloud 모드는 Earth/GPS를 요구하지 않는다. `geospatial: null`이며 카메라 GPS를 팁 좌표로 대입하지 않는다. 따라서 이번 Cloud 기록만으로 지도에 팁을 배치할 수는 없다. 최종 통합에는 독립적인 지도 탐색용 좌표와 공유 앵커 ID의 연결이 필요하다. Cloud Anchor 서비스는 Google의 관리형 서비스이며 자체 호스팅 오픈소스 VPS가 아니다.

SceneView는 렌더링·AR UI 재사용 후보지만, 현재 Kotlin 세션에서 필요한 API에 직접 접근할 수 있어 새 렌더러를 추가하지 않았다. AprilTag는 알려진 크기의 시각 마커로 자세를 추정하는 비교 후보다. 임의 장소마다 물리적 마커를 설치하는 조건이 달라 이번 기본 경로에는 넣지 않았다. 이는 현 저장소의 재사용성과 실험 범위를 고려한 판단이며 성능 우위를 측정한 결론이 아니다.

공식 근거:

- [ARCore Cloud Anchor 가이드](https://developers.google.com/ar/develop/java/cloud-anchors/developer-guide): host/resolve, 특징 품질, API 키 사용 시 최대 24시간.
- [ARCore 인증](https://developers.google.com/ar/develop/authorization?platform=android): 1일 초과 수명에는 키리스 인증 필요.
- [SceneView](https://github.com/sceneview/sceneview): AR 렌더링 프레임워크 후보.
- [AprilTag](https://github.com/AprilRobotics/apriltag): 알려진 마커 기준의 자세 추정 후보.

### 실험 조건과 기록 해석

- Hit 거리는 0.2~5m로 제한한다. 지원 기기에서는 세션의 Depth를 AUTOMATIC으로 설정하고, 체크박스로 DepthPoint를 Hit 선택에 포함할지 결정한다. 해제하면 Plane 내부 Hit만 허용한다. 이는 Depth 계산 자체를 끈 성능 비교가 아니다. `depthEnabled`, `depthHitAllowed`, 실제 `hitType`을 구분한다.
- 기존 Geospatial 복원 기준점은 기록의 `arcore-plane-hit-test` 의미를 유지하려고 평면만 사용한다. Cloud 복원 기준점은 Plane/Depth를 허용하고 실제 `referenceHitType`을 기록한다.
- Cloud 저장에는 카메라·앵커 TRACKING, 유효 배치, 드래그 종료, GOOD 특징 품질 1초 유지가 필요하다. 750ms를 넘는 관측 공백, 품질 저하, 추적 소실, 새 Hit 선택은 유지 시간을 초기화한다. 수치는 비교 실험용이며 제품 정확도 정책이나 정밀도 보증이 아니다.
- host/resolve는 60초 후 취소·재시도 상태로 전환한다. 복원 대기·실패·추적 중단 중 핀을 숨기며 GPS 위치나 예전 세션 XYZ로 대체하지 않는다. 백그라운드 전환·초기화 시 미완료 Future를 취소하고, 반환받아 사용하지 않은 Anchor는 해제한다. 취소가 이미 서버에서 처리된 host를 삭제하는 것은 아니다.
- API 키로 `ttlDays=1`을 요청한다. `hostedAt`은 요청 시작 시각이며 `expiresAtEstimate`는 여기에 24시간을 더한 로컬 추정값이다. 서버 만료시각을 조회한 값이 아니다. 만료 예상 기록은 열어볼 수 있지만 복원 진입을 막는다. 실제 만료·서비스 오류는 resolve 결과로 처리한다.
- 복원 기록은 최초 작성 기기·세션·로컬 Pose를 유지하고 최근 resolve 기기·세션·소요 시간을 따로 저장한다. 모델 이름은 고유 기기 ID가 아니다. `crossDeviceVerified`는 항상 false다.
- 초록 기준점과 주황 복원점의 차이는 같은 AR 세션에서 계산한 참고치다. `groundTruth=false`이며 줄자·측량 기준 오차로 간주하지 않는다. 서로 다른 세션의 XYZ를 직접 빼지 않는다.
- 지도 현재 위치의 10초 제한은 오래된 표시를 막는 실험용 조건이다. 융합 위치의 정확도 숫자를 표시하지만 상세 열람 권한을 허용하는 서버 검증은 구현하지 않았다.

### 변경 파일

- `App.tsx`, `CloudValidationPanel.tsx`: 새 실험 진입, JSON 불러오기·공유, 마지막 Cloud 결과 표시. 기존 지리 좌표 기록과 저장 슬롯 분리.
- `cloudAnchors.ts`, `__tests__/cloudAnchors.test.ts`, `jest.placement.config.js`: Cloud 기록 검증, 만료 경계·잘못된 좌표/자세·허위 성공 표시 방지 검사.
- `GeoArActivity.kt`: 기존 세션에 Cloud/Geospatial 모드 분기, Hit 선택, 방향·상태 표시, 기준점 비교.
- `CloudAnchorExperiment.kt`: 비동기 host/resolve, 품질 게이트, 취소·시간 초과와 Anchor 소유권 처리.
- `CloudRecord.kt`: GPS 없는 Cloud 기록과 수명·작성 기기·동작 메타데이터.
- `ArExperimentPolicy.kt`, `android/validation/ArExperimentPolicyCheck.kt`: 거리·신선도·안정 시간·카메라 상대 방향 순수 로직 검사.
- `GeoValidationModule.kt`: 기존 RN 브리지에 Cloud 진입/결과 저장 추가.
- `GeoMapActivity.kt`: 오래된 현재 위치 거절·만료·화면 이탈 시 제거.
- `android/validation/check-native.ps1`: AR 소스에 더해 지도와 RN 브리지 소스까지 캐시된 라이브러리로 컴파일.

### 검증 결과와 실행 절차

- Jest: 3개 suite, 26개 테스트 통과.
- Kotlin: 변경된 AR/지도/RN 브리지 소스 컴파일 통과. 기존 추적 정책 13개 + 새 실험 정책 24개 검사 통과. 기존 deprecated API 관련 경고는 남아 있다.
- TypeScript 및 변경 TS/TSX ESLint 검사: 통과.
- 전체 APK: `:app:assembleDebug`를 시도했으나 `Could not connect to the Gradle daemon`으로 실패. 앱 컴파일·패키징 완료를 확인하지 못했다.
- 실기기: `adb devices -l`에서 ADB 서버 시작/연결 실패. 새 코드 설치·Cloud 네트워크 응답·두 기기 복원·정확도 개선을 확인하지 못했다. 이전 APK는 이번 결과물이 아니다.

로컬 검사는 다음과 같이 다시 실행할 수 있다.

```powershell
npm.cmd run test:placement
npx.cmd tsc --noEmit
npx.cmd eslint App.tsx CloudValidationPanel.tsx cloudAnchors.ts __tests__/cloudAnchors.test.ts
.\android\validation\check-native.ps1 -SdkRoot 'C:\Users\SSAFY\AppData\Local\Android\Sdk'
```

두 기기 비교는 새 APK 설치 후 진행한다. ARCore API가 켜진 프로젝트의 기존 로컬 키 설정을 사용하며 키를 JSON이나 Git에 넣지 않는다.

1. 기기 A에서 `Cloud Anchor 복원 실험` → `새 Cloud Anchor 배치`. 실제 기준점을 정하고 터치·드래그로 배치한다.
2. 주변을 여러 각도에서 비춰 GOOD 상태를 유지한 뒤 `Cloud 저장`. 반환된 JSON을 기기 B로 공유한다.
3. 기기 B에서 JSON을 불러오고 같은 장소에서 `이 Cloud Anchor 복원·비교`. 원래 주변을 비춘 뒤 주황 핀이 나타나는지 확인한다.
4. 원래 실제 기준점을 터치해 초록 점을 만들고 `비교 기록`. 별도로 줄자 등으로 관찰한 차이, 복원 성공/실패, 조명, 거리, 소요 시간을 기록한다.
5. 같은 장소·기준점·기기 조합에서 평면만 / Depth Hit 허용을 각각 반복한다. 실패와 시간 초과도 표본에 포함한다. 다른 날·방향·조명에서도 반복한 뒤 복원율과 오차 분포로 선택한다.
6. 카메라 가림, 백그라운드 복귀, 네트워크 끊김, 재시도, 오래된 JSON에서 이전 핀이나 좌표가 현재 성공 결과처럼 표시되지 않는지 확인한다.

## 2026-10-29 재점검 및 첫 목표 보완 (이전 단계)

### 확인한 기준과 저장소 상태

- 2026-10-28자 「여기록 AR 팁 — 프로젝트 인수인계 및 AI 개발 작업 지침서」 전체 1,230줄과 Q1~Q40을 확인했다. 첨부 파일명은 `붙여넣은 텍스트(1)(6).txt`다.
- 작업 디렉터리: `C:\Users\SSAFY\projects\yeogirok-ar-poc`, 브랜치: `poc/arcore-basic`, 로컬 HEAD: `13da6e9` (Initial commit). GitHub에서도 해당 브랜치가 존재함을 확인했다. 원격 최신 커밋과의 동기화를 수행한 것은 아니다.
- 작업 시작 시 Git 추적 파일은 README.md와 .gitignore뿐이고, .gitignore 수정 및 앱 소스 대부분이 미추적 상태였다. 기존 코드를 초기화하거나 커밋·푸시하지 않았다. 수정 전 Activity와 이 문서를 로컬 임시 경로에 백업했다.
- 실제 프로젝트는 이미 React Native 앱이다. 이전 SceneView 데모는 형제 디렉터리 `../sceneview`에 있고, 현재 앱의 의존성이 아니다. 현재 Kotlin 화면은 SceneView 없이 ARCore와 기존 Google 카메라 배경 렌더러를 사용한다.
- 이번 변경은 Q14 터치 배치·Q15 위치 드래그를 유지한다. 중앙 조준점은 후속 UX 제안이며 이번에 대체하지 않았다. 정확도·안정 시간의 수치도 아직 제품 정책으로 확정하지 않았다.

### 현재 버전 (이번에 변경하지 않음)

| 항목 | 확인값 |
|---|---|
| React Native / React | 0.86.0 / 19.2.3 |
| ViroReact | @reactvision/react-viro 3.0.3 |
| ARCore | com.google.ar:core:1.57.0 |
| Kotlin / Android Gradle Plugin | 2.1.20 / 8.12.0 (RN Gradle plugin 버전 카탈로그) |
| Gradle wrapper | 9.3.1 |
| compileSdk / targetSdk / minSdk | 36 / 36 / 24 |
| NDK / Build Tools | 27.1.12297006 / 36.0.0 |
| Kakao Map / Play Services Location | 2.15.2 / 21.0.1 |

Viro renderer의 중복 ARCore C 라이브러리를 제외하는 `android/viro_renderer/build.gradle`과 네이티브 AR 화면의 `:geospatial` 프로세스 분리를 유지했다. 라이브러리 버전을 올리거나 렌더러를 추가하지 않았다. 기존 release 설정은 debug 서명을 사용하므로 현재 앱을 스토어 배포 준비 완료로 취급하지 않는다.

### 구현과 검증을 구분한 현재 상태

| 기능 | 소스 기준 상태 | 이번 검증 |
|---|---|---|
| Viro 로컬 Hit-test·핀·드래그·JSON | 기존 구현. provider=none, 지리 좌표와 공유 앵커는 미연결 | TS 검사 및 기존 순수 로직 검사 통과, 기기 재실행 미확인 |
| 네이티브 벽/바닥 Hit-test·앵커·최종 Pose | 기존 구현. 인식된 Plane 내부만 허용 | 변경 네이티브 소스 컴파일 통과 |
| 최종 팁 Pose → GeospatialPose·정확도 | 기존 구현, 확정 후 JSON 저장. 이번에 확정 전 실시간 표시 추가 | 소스 컴파일 통과, 실기기 좌표 실측 미확인 |
| React Native ↔ Kotlin 진입·결과 반환 | GeoValidationModule과 Activity result로 기존 구현 | 통합 APK 실행 미확인 |
| 지도·기준점 비교·JSON 가져오기·Geospatial 복원 | 기존 구현 | 동일 위치 복원 성공을 입증한 실측 결과 없음 |
| AR 자동 어긋남 추정 | 두 앵커를 같은 프레임에서 비교, groundTruth=false | 측량 정답값이 아님 |
| PAUSED 중 앵커 유지 / STOPPED 분리 | 이번 수정 | JVM 정책 검사 13개 통과, 물리적 흔들림 개선은 미검증 |
| Cloud Anchor 호스팅·복원·키리스 인증 | 앱 흐름에 미구현. 현재 네이티브 화면은 API 키 존재를 요구 | 미검증 |
| VPS 가용성 조회 / 품질 임계값·안정 시간 게이트 | 앱 흐름에 미구현 | 수치 정책 미확정 |
| Spring Boot/PostGIS·50m/10m 접근·하루 10개·반응·이력 | 이 저장소에 미구현 | 미검증 |
| 서비스용 최대 5개 팁·미니맵·하단 시트 | 미구현. 현재는 단일 핀 검증 화면 | 미검증 |

현재 지도는 개발용 좌표 검증 화면이며, 일반 발자취 지도에 AR 팁을 노출하는 서비스 구현이 아니다. 카메라 좌표는 `Earth.cameraGeospatialPose`의 ARCore 추정값이며 별도 GPS 센서 측정값으로 표시하지 않는다. 지도 화면의 현재 위치 조회와 팁의 지리 좌표를 혼동하지 않는다.

### 기술 비교 및 선택 근거

| 경로 | 터치 → 최종 Pose | 팁 자체의 지리 좌표 | 기기 간 복원 |
|---|---|---|---|
| 설치된 Viro 3.0.3 | performARHitTestWithPoint 및 드래그 API 존재 | getCameraGeospatialPose는 카메라용. 공개 TS API에서 임의 Pose → GeospatialPose 변환은 찾지 못함 | createGeospatialAnchor, hostCloudAnchor, resolveCloudAnchor 존재. 현재 비교 화면에서는 사용하지 않음 |
| 현재 Kotlin ARCore | 같은 Session에서 hitTest → hit.createAnchor → anchor.pose | Earth.getGeospatialPose(anchor.pose) 직접 사용 | Earth.createAnchor로 저장 좌표 복원 구현. Cloud Anchor는 별도 구현 필요 |
| 기존 SceneView Android 데모 | ARCore 기반 배치 구현을 참고할 수 있음 | 동일 세션의 Earth API 접근 경로 필요 | 앵커 API 접근과 현장 검증 필요. 현재 RN 앱에 자동 연결된 상태가 아님 |

따라서 첫 목표는 **기존 Kotlin 화면 재사용**으로 진행한다. Viro 세션의 XYZ를 별도 Kotlin 세션의 Earth에 전달하면 좌표계가 다르므로 올바른 변환이 아니다. Viro만 사용하려면 그 렌더러가 소유한 동일 세션에 변환 기능을 노출하는 별도 네이티브 확장이 필요하다. Viro에서 Google 제공자를 사용할 경우 공식 문서상 provider="arcore"를 명시해야 하지만, 현재 provider="none"인 로컬 비교 화면을 검증 없이 바꾸지는 않았다.

근거 파일:

- `ARHitTestView.tsx`, `placement.ts`: 로컬 좌표, provider=none, geospatial unavailable 명시.
- `node_modules/@reactvision/react-viro/components/AR/ViroARScene.tsx`: performARHitTestWithPoint.
- `node_modules/@reactvision/react-viro/components/AR/ViroARSceneNavigator.tsx`: host/resolveCloudAnchor, getCameraGeospatialPose, createGeospatialAnchor.
- `android/app/src/main/java/com/yeogirokarpoc/geo/GeoArActivity.kt`, `GeoRecord.kt`, `GeoValidationModule.kt`: 동일 세션 변환·기록·RN 반환.

### 이번 변경 파일과 동작

1. `android/app/src/main/java/com/yeogirokarpoc/geo/GeoArActivity.kt`: 250ms 간격으로 팁 XYZ·위경도·WGS84 고도·추정 정확도와 카메라 좌표, 앵커 상태를 구분해서 표시한다. 추적 불가 시 이전 좌표를 현재 측정값으로 보여주지 않는다. 좌표를 Logcat에 추가하지 않는다.
2. `android/app/src/main/java/com/yeogirokarpoc/geo/GeoTrackingPolicy.kt`: PAUSED에서는 앵커를 유지하고 표시/확정을 중단한다. STOPPED 앵커는 폐기한다. 복원 핀은 Earth 추적이 끊겨도 숨긴다. 신규 로컬 배치는 Earth 대기 중 미리보기만 허용하고 지리 좌표 확정은 차단한다.
3. `android/validation/GeoTrackingPolicyCheck.kt`: 카메라/앵커 일시 중단, 복구, Earth 소실, STOPPED, 기준점 중단, 잘못된 배치의 13개 회귀 검사.
4. `android/validation/check-native.ps1`: 기존 캐시의 Kotlin 2.1.20, ARCore 1.57.0으로 네이티브 AR 소스를 컴파일하고 JVM 정책 검사를 실행한다. 새 의존성을 다운로드하지 않는다.
5. 이 문서: 조사 결과와 재현 절차를 추가한다.

앱 백그라운드 전환 후 재개 시의 기존 명시적 초기화는 유지한다. 이번 변경은 동일한 실행 중 발생하는 일시적 추적 소실에 대한 처리다. 정확도 수치를 작게 보이게 만들거나 복원 성공 여부를 자동으로 true로 바꾸지 않았다.

### 이번 실행 결과

- `npm run test:placement`: 쓰기 가능한 캐시 경로를 지정한 재시도에서 2개 suite / 11개 테스트 통과.
- `npx tsc --noEmit`: 통과.
- `android/validation/check-native.ps1`: 네이티브 Kotlin 소스 컴파일 및 13개 정책 검사 통과. 기존 defaultDisplay 사용에 대한 deprecated 경고 1개.
- 전체 `:app:assembleDebug`: **완료하지 못함**. 기본 경로는 Gradle wrapper 잠금 파일 접근 거부, 프로젝트 내부 Gradle 캐시 재시도는 데몬 연결 실패. APK 패키징·네이티브 라이브러리 로딩 검증은 수행되지 않았다.
- `adb devices -l`: ADB daemon 시작 실패. 이번 변경의 설치·카메라 실행·터치·실측 테스트는 수행하지 못했다. 기존 2026-10-29 오전 11:12 APK는 이번 변경을 포함하지 않는다.
- `android/local.properties`, debug.keystore, 실제 위치 JSON 디렉터리는 Git 제외 상태를 확인했다. 키 값을 출력하거나 커밋하지 않았다.

재현 명령 (프로젝트 루트, 기존 의존성과 SDK가 설치된 환경):

```powershell
npm run test:placement -- --cacheDirectory ./node_modules/.cache/jest-placement
npx tsc --noEmit
.\android\validation\check-native.ps1 -SdkRoot 'C:\Users\SSAFY\AppData\Local\Android\Sdk'
cd android
.\gradlew.bat :app:assembleDebug
```

소스 컴파일 검사는 APK 빌드/설치의 대체 증거가 아니다. 기기 설치에는 기존 `npm run android` 흐름을 사용하고 아래를 확인한다.

1. 홈 → 지리 좌표·지도 검증 → 새 AR 팁 위치 측정. 실외에서 카메라·Earth TRACKING을 기다린다.
2. 휴대폰에서 1~3m 떨어진 표시된 벽/바닥에 터치하고 드래그한다. 팁 좌표가 카메라 좌표와 별도로 표시되고 최종 핀 끝을 따르는지 확인한다.
3. 카메라를 잠시 가려 PAUSED를 유도한다. 핀/확정 버튼이 숨김·비활성 상태가 되는지, 다시 주변을 비춘 뒤 기존 지점에 복구되는지 관찰한다. 재배치와 위치 점프 여부를 따로 기록한다.
4. 위치 확정 후 JSON의 tip·cameraAtCapture·localPose·accuracy를 확인한다. 추정 정확도는 실제 오차 보장이 아니다.
5. 기기 A의 JSON을 B에서 가져온 뒤 동일 표시점과 복원 핀을 줄자 등으로 비교한다. 1m/2m 이내 비율, 실패율, 복원 대기시간을 기록하고 AR 자동 추정값과 실측값을 구분한다.
6. 실내 Geospatial 실패는 성공 처리하지 않는다. 다음 단계에서 기존 Kotlin 세션에 Cloud Anchor 생성·복원을 추가해 동일 조건으로 비교한다.

공식 참고: [Earth Pose 변환](https://developers.google.com/ar/reference/java/com/google/ar/core/Earth), [TrackingState](https://developers.google.com/ar/reference/java/com/google/ar/core/TrackingState), [GeospatialPose](https://developers.google.com/ar/reference/java/com/google/ar/core/GeospatialPose), [Viro Geospatial](https://viro-community.readme.io/docs/geospatial), [Viro Cloud Anchors](https://viro-community.readme.io/docs/cloud-anchors).

## 구현된 흐름

- 홈 → **지리 좌표·지도 검증** → 네이티브 ARCore 화면에서 평면 터치 → 핀 드래그 → 최종 위치 확정.
- Hit-test, 앵커, `Earth.getGeospatialPose(anchor.pose)`는 하나의 ARCore 세션에서 실행한다. Viro의 세션 XYZ를 별도 세션에 넣어 변환하지 않는다.
- 기존 **Viro 로컬 AR 핀** 화면은 독립된 로컬 배치 실험이다. 지도 검증은 홈의 지리 좌표 메뉴로 시작한다.
- 네이티브 핀은 앵커를 화면에 투영한 2D 표시다. 핀 끝이 측정 위치이며 실제 3D 모델·가림 처리는 구현 범위 밖이다.
- 팁 위도·경도·WGS84 타원체 고도·EUS 회전, 측정 당시 카메라 좌표, 추정 수평/수직/yaw 정확도(68%)를 기록한다.
- 카카오 지도: 빨강=팁, 파랑=측정 당시 카메라, 초록=기준점, 보라=현재 위치 갱신 결과. 현재 위치의 추정 정확도와 측정 경과시간도 표시한다.
- 지도 비교점 선택 또는 기준 좌표 수동 입력 → 구면근사 수평거리 계산. 기준점 출처·불확실성을 함께 기록한다.
- 최근 기록을 기기에 저장하며 앱 재실행 시 복구한다. JSON 보기·공유·가져오기·삭제를 지원한다. 서버 업로드는 없다.
- 다른 기기에서 JSON 가져오기 → 같은 장소에서 지리 앵커 복원 → 위치 확정 → 원래 지점과의 실측 수평/수직 어긋남, 측정 방법, 기기 이름 저장.
- 복원 결과에는 원래 목표 좌표와 부모 기록 ID를 보존한다. 추정 정확도나 지도 거리만으로 기기 간 복원 성공을 자동 판정하지 않는다.

## 필요한 로컬 설정

Git에서 제외된 `android/local.properties`에 다음 값을 설정한다. 이미 있는 SDK 경로나 설정을 덮어쓰지 않는다.

```properties
sdk.dir=C:/Users/SSAFY/AppData/Local/Android/Sdk
ARCORE_API_KEY=발급받은_ARCore_API_키
KAKAO_NATIVE_APP_KEY=발급받은_카카오_네이티브_앱_키
```

환경 변수 `ARCORE_API_KEY`, `KAKAO_NATIVE_APP_KEY`도 지원하며 환경 변수가 우선이다.

- Google Cloud 프로젝트에서 ARCore API를 활성화하고 해당 Android 앱에 맞게 인증을 설정한다.
- 카카오 앱에 Android 플랫폼/패키지 `com.yeogirokarpoc`와 실제 서명 키 해시를 등록하고 지도 사용 권한을 설정한다.
- 키 값 자체를 소스·채팅·로그에 붙이지 않는다. 앱의 키 표시 상태는 문자열 설정 여부만 의미하며 인증 성공을 보장하지 않는다.
- 카메라와 정확한 위치 권한, 네트워크, 지원 기기 및 Google Play Services for AR가 필요하다.

## 자동 검사 및 빌드

```powershell
npm run test:placement -- --cacheDirectory ./node_modules/.cache/jest-placement
npx tsc --noEmit
npx eslint App.tsx ARHitTestView.tsx ARTipMarker.tsx placement.ts geospatial.ts GeoValidationPanel.tsx __tests__/geospatial.test.ts
```

네이티브 Activity/브리지/권한/지도 SDK가 추가되었으므로 Metro 새로고침만으로는 적용되지 않는다. 키 설정 후 재빌드가 필요하다.

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:Path = "$env:ANDROID_HOME\platform-tools;$env:Path"
npm run android -- --active-arch-only --port 8081 --no-packager
```

## 실기기에서 한 번에 확인할 목록

1. 지리 좌표 메뉴 → 권한/안내 → 실외에서 카메라·Earth 추적 상태 확인.
2. 중앙/좌/우 표면에 핀 배치. 핀을 끌고 손을 뗀 최종 지점으로 확정되는지 확인.
3. Earth 추정 정확도가 표시되고 유효한 좌표만 기록되는지 확인. 실내나 위치 추정 실패는 성공으로 취급하지 않는다.
4. 지도에서 팁과 측정 당시 카메라 위치를 구분. 현재 위치 갱신, 기준점 선택/직접 입력, 거리 계산 확인.
5. 앱 재실행 후 기록 보존, JSON 공유/가져오기 확인.
6. 두 번째 기기에서 같은 좌표 복원. 바닥 표시점과 핀 사이를 직접 재고 실측 기록을 저장.
7. 뒤로가기/취소/백그라운드 복귀, 위치 권한 거부, 잘못된 JSON, 네트워크/인증 실패 경로 확인.

## 한계와 검증 상태 (2026-10-28)

- TypeScript/ESLint 및 배치·지리 좌표 단위 테스트로 순수 로직을 검증한다. 실제 AR/지도 동작을 대체하지 않는다.
- 이 작업 환경에서 기본 Gradle 캐시 쓰기가 거부되었고, 프로젝트 내부 캐시를 사용한 시도에서도 Gradle 데몬 연결이 실패했다. 네이티브 컴파일/APK 생성·실기기 테스트는 미확인이다.
- Google/Kakao API 키와 앱 등록은 별도로 완료해야 한다. 키 없이도 코드는 검사할 수 있으나 실제 지리 좌표/지도 서비스는 동작하지 않는다.
- 수동 지도 점은 측량 기준점이 아니다. 거리값 소수점 자릿수는 정밀도를 의미하지 않는다.
- 지리 앵커 기반 복원이며 Cloud Anchor 호스팅/해결 방식은 아니다. 실내 정밀 복원·백엔드 동기화·자동 오차 합격 판정은 포함하지 않는다.

## 공식 자료

- https://developers.google.com/ar/reference/java/com/google/ar/core/Earth
- https://developers.google.com/ar/reference/java/com/google/ar/core/GeospatialPose
- https://developers.google.com/ar/develop/java/geospatial/enable
- https://apis.map.kakao.com/android_v2/docs/getting-started/quickstart/

## 2026-10-28: AR 세션 생성 시 네이티브 충돌 대응

사용자 로그에서 `GeoArActivity.ensureSession → Session.<init> → nativeCreateSessionAndWrapperWithFeatures → ArSession_createWithFeaturesImplementation` 호출 중 `libarcore_c.so`의 SIGSEGV/SEGV_ACCERR를 확인했다. 이는 세션 구성과 지리 좌표 인증 이전이며 Kotlin Exception 처리로 복구할 수 있는 오류가 아니다. 라이브러리 내부 원인이나 SDK 버전 문제가 확정된 것은 아니다.

- 직접 ARCore를 사용하는 `GeoArActivity`를 앱 전용 `:geospatial` 프로세스에서 실행하도록 분리했다.
- 해당 프로세스에서는 `MainApplication`이 React Native/Hermes/Viro를 초기화하지 않는다. 기존 Viro 화면은 주 프로세스에 유지한다.
- 좌표 JSON은 Activity result로 주 프로세스에 반환하고 그곳에서만 저장한다. 동의 상태는 AR 프로세스 전용 SharedPreferences 파일에 저장한다.
- `YeogirokGeo` 태그에 세션 생성 시작/완료를 기록한다. 키와 좌표는 로그에 출력하지 않는다.
- Earth 정확도 문구의 `String.format`용 퍼센트 기호를 `%%`로 수정했다. 이 문구 오류는 세션 생성 SIGSEGV와 별개의 문제다.
- 의존성 버전은 유지했다. 프로세스 분리는 라이브러리 동시 로드에 의한 충돌 가능성을 제거하기 위한 조치이며, 실제 해결 여부는 재설치 후 확인해야 한다.
- 재검증: 새 AR 화면 진입 → 세션 생성/카메라 표시 → Earth 추적 → 확정 결과가 원래 화면으로 반환되는지 확인. 취소/재진입도 확인한다.

## 2026-10-28: 프로세스 분리 후 재현 / Java·JNI SDK 교체

17:36~17:37 로그에서 `com.yeogirokarpoc:geospatial` 프로세스에서도 동일한 `ArSession_createWithFeaturesImplementation` SIGSEGV가 재현됐다. 따라서 React Native/Viro와 같은 프로세스에서 실행된다는 사실만으로 이 충돌을 설명할 수 없다. 휴대폰 AR 서비스 보고 버전은 `1.57.262640093`이며 기존 앱 Java/JNI SDK는 `1.43.0`이었다. 버전 차이 자체가 오류 원인으로 확정된 것은 아니다.

다음 검증을 위해 앱의 Java/JNI 의존성을 공식 Maven `com.google.ar:core:1.57.0`으로 교체했다. `:arcore_client`의 include, projectDir, implementation을 제거해 1.43 flat AAR가 함께 포함되지 않게 했다. Viro renderer가 소유한 C 클라이언트 라이브러리는 그대로이며, 직접 Java/JNI를 쓰는 지리 좌표 화면은 계속 별도 프로세스에서 실행한다.

- 사용 중인 Viro renderer/bridge AAR에 ARCore Java 클래스와 `libarcore_sdk_jni.so`가 중복되지 않음을 확인했다.
- 공식 1.57.0 AAR을 사용한 변경 Kotlin 파일의 단독 컴파일 검사가 통과했다. 전체 Gradle 빌드/APK 실행 검증을 대신하지 않는다.
- 지리 좌표 검증 화면에 `앱 ARCore SDK: 1.57.0`을 표시해 새 빌드 설치 여부를 확인하도록 했다.
- 실제 세션 생성 성공과 기존 Viro 화면의 호환성은 재빌드·재설치 후 기기 검증이 남아 있다.

## 2026-10-29: ARCore C 라이브러리 중복 패키징 수정

1.57.0 재빌드 시 ":app:mergeDebugNativeLibs"에서 Viro renderer와 공식 ARCore AAR의 "libarcore_sdk_c.so"가 중복되어 실패했다. 앞선 Java/JNI 검사만으로는 C 라이브러리 중복을 발견하지 못했다.

- "android/viro_renderer/build.gradle"에 renderer AAR를 다시 구성하는 Gradle Zip 작업을 추가했다. 원본의 "jni/**/libarcore_sdk_c.so"만 제외하고 나머지 항목을 유지한다.
- "settings.gradle"의 "viro_renderer" 프로젝트를 이 모듈로 연결했다. 작업 결과 AAR를 의존성으로 공개하므로 빌드 시 자동 생성된다. node_modules와 Gradle 캐시는 수정하지 않는다.
- 앱의 Java/JNI/C ARCore 라이브러리는 공식 "com.google.ar:core:1.57.0"에서 공급한다. Viro 자체 renderer/bridge는 그대로 사용한다.
- 검사 범위: 원본 AAR의 JNI 파일 목록 비교, 제외 후 중복 여부, Viro의 ARCore 외부 함수와 새 C 라이브러리의 export 비교. 전체 Gradle 패키징 및 실제 기기에서 양쪽 AR 화면 실행은 별도 확인이 필요하다.
- 참고: https://docs.gradle.org/current/userguide/how_to_share_outputs_between_projects.html 및 https://docs.gradle.org/current/dsl/org.gradle.api.tasks.bundling.Zip.html

## 2026-10-29: 실기기 AR 진입 성공 / 카카오 지도 진단 보완

사용자가 재설치 후 카메라와 Earth 추정 정확도 표시를 확인했다. 이전 세션 생성 SIGSEGV 지점은 이번 실행에서 통과했다. 이후 지도 비교 화면이 검게 보인다고 보고했으며, 지도 인증/네트워크/렌더링 중 원인은 아직 확인되지 않았다.

- 좌표 요약과 별도로 지도 로딩 상태, SDK 준비 완료, 오류 종류/코드/메시지를 표시한다. 오류 메시지에서 앱 키와 32자리 hex 문자열은 가린다. 로그에는 오류 종류/코드와 준비 단계/뷰 크기만 남긴다.
- 20초 동안 준비 콜백이 없으면 대기 안내를 표시한다. 이는 시간 초과 원인을 확정하는 판정이 아니다.
- 화면 내 지도 재시도 버튼은 현재 기록을 유지한 채 Activity를 재생성한다. 비교점 선택은 지도 준비 이후 활성화한다.
- 좌표 요약은 고정 높이 스크롤 영역으로 바꿔 작은 화면에서 지도 공간을 확보한다. 기존 resume/pause/finish 처리는 유지하며 SDK 초기화에는 applicationContext를 사용한다.
- 재설치 후 준비 완료/오류 코드/대기 문구를 확인해야 한다. 지도 준비 완료는 실제 타일 표시 확인을 대신하지 않는다.
- 참고: https://apis.map.kakao.com/android_v2/docs/getting-started/quickstart/ 및 https://apis.map.kakao.com/android_v2/reference/com/kakao/vectormap/MapAuthException.html

## 2026-10-29: 기준점 입력 결과 표시 개선

기준점 반영 버튼의 검증 오류와 성공 안내가 화면 최상단에만 표시되어 스크롤 아래에서는 반응을 확인하기 어려웠다. 계산 버튼 바로 아래에 저장 진행/오류/완료 안내와 저장된 기준점 좌표·출처·수평거리를 표시하도록 변경했다. 위도·경도 범위와 불확실성 숫자 입력 오류를 구체적으로 안내한다. 직접 입력 선택은 좌표 자동 입력이 아니라 출처 분류이며, 지도에서 선택한 기준점은 수동 재입력이 필요 없음을 설명한다. TypeScript 및 해당 파일 ESLint 검사는 통과했다. 실제 기기에서 메시지 위치와 저장 흐름 확인은 남아 있다.

## 2026-10-29: 기준점 출처 자동 입력

출처 토글을 선택 메뉴로 바꿨다. 직접 입력/측량 기준점을 선택하면 출처 설명을 자동으로 채우며, 같은 유형에서 사용자가 작성한 설명은 유지한다. 저장된 기준점 불러오기는 좌표·출처·불확실성을 함께 복원한다. 지도 비교 화면에서 돌아왔을 때도 기준점을 입력란에 반영한다. 지도 선택 출처(map-tap)는 유지하되, 위도·경도를 직접 편집하면 수동 수정 출처로 바꾼다. AR 팁 좌표를 기준점으로 자동 복사하지 않는다.

## 2026-10-29: 복원 위치 차이 AR 자동 기록

- 복원 화면의 터치는 복원된 주황 핀을 옮기지 않고 원래 실제 지점을 선택한다. 인식된 평면을 선택하면 별도 Anchor를 만들고 초록 점으로 표시한다. 일반 신규 배치의 드래그 동작은 유지한다.
- 동일 Session.update() 프레임에서 복원 Anchor와 선택 Anchor의 pose를 읽어 수평 거리 hypot(dx, dz), 수직 차이 dy(복원 위치가 위쪽이면 +)를 계산한다. 세션이 다른 과거 XYZ와 비교하지 않는다. 두 Anchor와 카메라/Earth 추적 상태가 유효할 때만 값을 기록한다.
- 최종 위치 확정 시 restorationEstimate에 수평/수직 차이, arcore-plane-hit-test 방법, 제조사/모델, 시각, groundTruth=false를 저장한다. 수치가 없을 때 0으로 채우지 않는다. 추적 소실/배치 초기화 시 선택 Anchor도 해제한다.
- AR 자동 추정은 평면 인식·터치·추적 오차가 포함되므로 실제 정답 좌표나 줄자 실측으로 취급하지 않는다. restorationObservation은 별도 수동 측정용으로 유지하고, 추정값을 실측 입력란에 자동 복사하지 않는다. 기기명은 자동 입력하며 수동 측정 방법은 버튼으로 선택할 수 있다.
- 반복 복원은 restorationTarget이 있으면 그 원래 목표를 사용한다. 이전 복원에서 다시 추정된 tip 좌표를 새 원점으로 누적 사용하지 않는다.
- 기존 JSON 기록과 호환되는 선택 필드로 추가했고, 잘못된 출처/수치/시각 및 groundTruth=true를 거부하도록 TS/Kotlin 양쪽에서 검증한다.
- 실기기 확인: 재빌드 → 저장 좌표로 AR 복원 → 원래 실제 지점 터치 → 초록 점과 수평/수직 추정값 확인 → 최종 위치 확정 → 자동 기록 카드 확인. 이 흐름과 추적 소실 후 재선택은 실제 기기 검증이 남아 있다.
- 참고: https://developers.google.com/ar/reference/java/com/google/ar/core/Pose

## 2026-10-29: 복원 핀이 보이지 않을 때 상태 안내 및 재시도

사용자가 저장 좌표 복원 후 주황 핀이 보이지 않는다고 보고했다. 현장 원인은 아직 확인하지 못했다. 기존 코드는 카메라 뒤/화면 밖 투영을 null로만 처리해 안내가 없었고, Anchor 생성 성공 전에 restoreAttempted를 true로 설정해 생성 예외 이후 재시도를 막을 수 있었다.

- 핀 추적 대기/종료, 카메라 뒤, 화면 좌우/상하 밖, near/far 범위 밖을 구분해 상태 안내를 표시한다. 핀이 보이지 않을 때 카메라 영역에도 안내를 표시한다. 실제 Anchor 좌표는 변경하지 않는다.
- 추적 중인 핀에 대해 카메라 기준 수평거리와 높이 차이를 표시한다. 이는 카메라 대비 AR 추정값이며 원래 지점 대비 실제 오차가 아니다.
- 생성 성공 후에만 완료 표시를 설정한다. 실패는 2초 간격으로 최대 3회 시도하고 예외 종류를 표시한다. 복원 화면의 두 번째 버튼은 원래 좌표를 유지하는 ‘좌표 재복원’이다.
- 일시적인 프레임 예외가 복원 핀의 유효 상태를 영구히 꺼버리지 않도록 했다. 긴 상태 설명은 높이가 제한된 스크롤 영역에 넣어 카메라 영역을 확보한다.
- 검증: 수정 네이티브 소스 단독 컴파일 통과. 순수 Kotlin 투영 함수의 중앙/경계/좌우상하/뒤쪽/w=0/near/far/비정상 수치/뷰 크기/원근 나눗셈 14개 검사를 통과했다. 전체 Gradle 빌드와 실기기 동작은 사용자 재설치 후 확인 필요.
- 재확인: 저장 좌표로 AR 복원 → 핀 상태/방향과 카메라 기준 거리 확인 → 필요 시 좌표 재복원. 핀을 원래 지점으로 강제 이동시키는 보정은 하지 않는다.

## 2026-10-29: 좌표 재복원 시 초록 기준점 유지

좌표 재복원 버튼이 전체 Anchor 초기화를 호출해 사용자가 선택한 초록 기준점까지 사라졌다. 수동 좌표 재복원 요청을 분리하고, 같은 실행 중인 AR 세션에서는 주황 Geospatial Anchor만 교체하도록 수정했다. 초록 기준점 Anchor를 유지해 새 주황 핀과의 차이를 같은 프레임에서 재계산한다. 카메라 추적 소실 또는 세션 재개에 따른 전체 초기화는 양쪽 Anchor를 제거하며, 이 경우 원래 지점을 다시 선택하라는 안내를 표시한다. 신규 배치의 다시 배치 동작은 기존 전체 초기화를 유지한다. 실제 기기에서 초록 점 유지와 추적 소실 시 안내 확인이 필요하다.

## 2026-10-29: 다른 기기용 로컬 JSON 미리 채우기

사용자가 전달한 검증 JSON을 Git에서 제외된 validation-records/restore-input.json 및 prefill.js에 원래 값대로 저장했다. Metro는 개발 번들의 지정 입력 모듈에만 로컬 prefill을 연결한다. 파일이 없는 새 체크아웃과 비개발 번들은 빈 기본 모듈을 사용한다. 입력란을 채울 뿐 기존 기기 기록을 자동 덮어쓰지 않으며, 사용자가 JSON 검증 후 가져오기를 눌러야 저장된다. 다시 채우기 버튼도 제공한다. Metro 설정이 바뀌었으므로 서버 재시작과 앱 다시 불러오기가 필요하며, 네이티브 재빌드는 필요 없다. 가져온 추정값과 실측 입력값은 이전 기기 기록임을 표시하고 새 기기 복원 결과와 구분한다. JSON 형식 검사 및 개발/비개발/파일 부재 분기 확인을 통과했다.

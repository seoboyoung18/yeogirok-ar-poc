# 여기록 AR PoC

React Native 화면과 Android ARCore를 연결해, 실제 공간에 남긴 팁을 다시 찾는 경로를 검증하는 프로젝트입니다.

작업 브랜치: `poc/arcore-basic`.

## 현재 흐름

- 홈 → 팁 작성(글 필수·사진 선택) → AR 터치 배치·드래그 조정 → Cloud Anchor 저장
- 저장한 팁 → 미니맵·방향 안내 또는 현장 인식 → 앵커 복원 → 주황 핀 터치 → 글·사진 상세
- AR 실험실 → Viro 로컬 배치, Geospatial 좌표, Cloud 복원 및 위치 차이 비교

현재 팁 콘텐츠는 **내 기기에 저장한 작성자 미리보기**입니다. Spring Boot/PostGIS 백엔드, 사용자 간 콘텐츠 공유, 서버의 거리·정확도 기반 상세 열람 정책은 아직 연결하지 않았습니다. Cloud 앵커의 예상 수명은 1일이며, 만료되어도 로컬 글·사진은 유지합니다.

지도에서 직접 선택한 탐색 위치, AR 세션 좌표, ARCore 지리 좌표는 구분합니다. 사용자 GPS를 터치한 팁의 정확한 좌표로 간주하지 않습니다. 기기 간 위치 복원 성능은 별도의 현장 검증이 필요합니다.

## 사용 중인 버전

| 항목 | 버전 |
| --- | --- |
| React Native / React | 0.86.0 / 19.2.3 |
| ViroReact | 3.0.3 |
| Android ARCore | 1.57.0 |
| Kakao Maps Android | 2.15.2 |
| Kotlin / Gradle | 2.1.20 / 9.3.1 |

직접 ARCore를 사용하는 화면은 Viro와의 네이티브 라이브러리 충돌을 피하기 위해 별도 Android 프로세스에서 실행합니다. iOS 디렉터리는 RN 프로젝트 기본 구성으로, 이번 Android 기능을 iOS에서도 검증했다는 의미는 아닙니다.

## 개발 환경

Node.js 22.11 이상, Android SDK/API 36, 프로젝트 Gradle 설정에 맞는 Java 환경이 필요합니다. JS 의존성은 `npm ci`로 잠금 파일에 맞춰 설치합니다.

`android/local.properties` 또는 로컬 환경 변수에 다음 키를 설정합니다. 실제 값과 SDK 경로는 커밋하지 않습니다.

```properties
ARCORE_API_KEY=<로컬에서 설정>
KAKAO_NATIVE_APP_KEY=<로컬에서 설정>
```

`android/app/debug.keystore`도 Git에서 제외합니다. 새 환경에서는 해당 경로에 로컬 디버그 키를 준비해야 합니다. API 서비스 활성화와 앱 패키지·서명 등록은 본인의 개발 환경에 맞춰 설정합니다.

## 실행과 진단

USB 디버깅을 허용한 Android 기기를 연결하고 저장소 루트의 일반 PowerShell에서 실행합니다.

```powershell
# 빌드, 데이터 유지 설치, Metro 확인, 앱 실행
.\android\validation\check-device.ps1 -Mode Prepare

# 이미 설치한 APK를 확인한 뒤 재실행
.\android\validation\check-device.ps1 -Mode Launch

# Metro 내부 그래프 오류 시 이 프로젝트의 Metro만 확인해 재시작
.\android\validation\check-device.ps1 -Mode Launch -RestartMetro

# 앱에 해당하는 실기기 진단 로그 수집
.\android\validation\check-device.ps1 -Mode Capture
```

기기 로그와 실제 좌표·앵커 기록은 Git에서 제외된 `validation-records/`에 보관합니다. 검증 스크립트는 오프라인 Gradle 빌드를 사용하므로 새 환경은 먼저 필요한 의존성을 준비해야 합니다.

## 검증

```powershell
npm.cmd run test:placement
npx.cmd tsc --noEmit
.\android\validation\check-native.ps1
.\android\validation\check-metro-response.ps1
```

- JS 정책 테스트 48개, Kotlin 정책 검사 88개, Metro 응답·재시작 보호 검사 22개 통과.
- Android APK 빌드·설치와 새 프로세스의 Android 개발 JS 번들 생성 성공을 확인했습니다.
- 기본 `App.test.tsx` 화면 테스트는 현재 `@react-native/jest-preset` 패키지가 없어 실행되지 않습니다. 위 순수 JS 검사는 별도 설정을 사용합니다.
- 네이티브 단독 컴파일이나 정책 테스트는 실기기의 화면·사진 표시 및 실제 위치 오차 검증을 대신하지 않습니다.

[AR 검증 기록](docs/AR_POC_VALIDATION.md) · [홈·팁 상세 구현과 실기기 확인 순서](docs/LOCAL_TIP_EXPERIENCE.md)

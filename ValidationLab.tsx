import { useState } from 'react';
import {
  Button,
  Linking,
  PermissionsAndroid,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ARHitTestView from './ARHitTestView';
import GeoValidationPanel from './GeoValidationPanel';
import CloudValidationPanel from './CloudValidationPanel';

export default function ValidationLab({ onBack }: { onBack: () => void }) {
  const [started, setStarted] = useState(false);
  const [geoMode, setGeoMode] = useState(false);
  const [cloudMode, setCloudMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('AR 시작 버튼을 눌러 주세요.');

  async function startAR() {
    setBusy(true);

    try {
      const result = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.CAMERA,
      );

      if (result === PermissionsAndroid.RESULTS.GRANTED) {
        setMessage('터치로 핀 배치 → 드래그로 조정 → 위치 확정');
        setStarted(true);
      } else if (result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        setMessage('앱 설정에서 카메라 권한을 허용해 주세요.');
      } else {
        setMessage('카메라 권한이 필요합니다. AR 시작을 다시 눌러 주세요.');
      }
    } catch {
      setMessage('카메라 권한 요청에 실패했습니다. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
    }
  }

  if (geoMode || cloudMode) {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.screen}>
          {cloudMode ? (
            <CloudValidationPanel onBack={() => setCloudMode(false)} />
          ) : (
            <GeoValidationPanel onBack={() => setGeoMode(false)} />
          )}
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.screen}>
        <View style={styles.header}>
          <Button title="← 여기록 홈" onPress={onBack} />
          <Text style={styles.title}>여기록 AR PoC</Text>
          <Text style={styles.text}>{message}</Text>
        </View>

        {started ? (
          <>
            <ARHitTestView />
            <Button title="처음으로" onPress={() => setStarted(false)} />
          </>
        ) : (
          <View style={styles.intro}>
            <Text style={styles.text}>
              카메라로 주변 공간의 움직임을 추적합니다. 밝은 곳에서 바닥과 주변
              물체를 천천히 비춰 주세요.
            </Text>
            <Text style={styles.text}>
              이 앱은 Google Play Services for AR를 사용합니다.
            </Text>
            <Button
              title="지리 좌표·지도 검증"
              onPress={() => setGeoMode(true)}
            />
            <Button
              title="Cloud Anchor 복원 실험"
              onPress={() => setCloudMode(true)}
            />
            <Button
              title="Google 개인정보처리방침"
              onPress={() => {
                Linking.openURL('https://policies.google.com/privacy').catch(
                  () => setMessage('브라우저를 열지 못했습니다.'),
                );
              }}
            />
            <Button
              title={busy ? '권한 확인 중…' : 'Viro 로컬 AR 비교'}
              disabled={busy}
              onPress={startAR}
            />
            <Button
              title="앱 권한 설정 열기"
              onPress={() => {
                Linking.openSettings().catch(() =>
                  setMessage('앱 설정을 열지 못했습니다.'),
                );
              }}
            />
          </View>
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#111827' },
  header: { padding: 16, gap: 8 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: 'bold' },
  text: { color: '#ffffff', fontSize: 15, lineHeight: 23 },
  intro: { flex: 1, justifyContent: 'center', padding: 24, gap: 20 },
});

import { useEffect, useState } from 'react';
import {
  Button,
  NativeModules,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { parseCloudRecord } from './cloudAnchors';
import type { CloudRecord } from './cloudAnchors';

type Bridge = {
  getStatus(): Promise<{
    arcoreKeyConfigured: boolean;
    kakaoKeyConfigured: boolean;
  }>;
  getLastCloudRecord(): Promise<string | null>;
  openCloud(restoreJson: string | null): Promise<string | null>;
  openCloudMap(raw: string): Promise<string | null>;
  openCloudNavigation(raw: string): Promise<string | null>;
};
const bridge = NativeModules.GeoValidation as Bridge | undefined;

export default function CloudValidationPanel({
  onBack,
}: {
  onBack: () => void;
}) {
  const [record, setRecord] = useState<CloudRecord | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [mapConfigured, setMapConfigured] = useState(false);
  const [message, setMessage] = useState(
    '같은 실제 지점을 다른 기기에서 복원하는 실험입니다.',
  );
  useEffect(() => {
    let active = true;
    if (!bridge?.openCloud) {
      setMessage('Cloud 기능을 포함해 Android 앱을 다시 빌드해야 합니다.');
      return;
    }
    Promise.all([bridge.getStatus(), bridge.getLastCloudRecord()])
      .then(([status, saved]) => {
        if (!active) {
          return;
        }
        setConfigured(status.arcoreKeyConfigured);
        setMapConfigured(status.kakaoKeyConfigured);
        if (saved) {
          setRecord(parseCloudRecord(saved));
        }
        if (!status.arcoreKeyConfigured) {
          setMessage('ARCore API 키 설정 후 Android 재빌드가 필요합니다.');
        }
      })
      .catch(error => {
        if (active) {
          setMessage(String(error));
        }
      });
    return () => {
      active = false;
    };
  }, []);

  async function run(action: () => Promise<void>) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await action();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function open(restore: boolean) {
    if (!bridge) {
      throw new Error('Android 재빌드가 필요합니다.');
    }
    const source =
      restore && record
        ? JSON.stringify(parseCloudRecord(JSON.stringify(record), true))
        : null;
    const raw = await bridge.openCloud(source);
    if (raw) {
      setRecord(parseCloudRecord(raw));
      setMessage(
        restore
          ? '복원 참고 측정을 기록했습니다. 실제 정확도는 원래 지점과 비교해 확인하세요.'
          : 'Cloud 저장 완료. JSON을 다른 기기에 전달해 같은 장소에서 복원하세요.',
      );
    } else {
      setMessage('실험 화면을 닫았습니다. 기존 기록은 유지합니다.');
    }
  }
  async function navigate(editLocation: boolean) {
    if (!record || !bridge?.openCloudNavigation || !bridge.openCloudMap) {
      throw new Error(
        '미니맵 기능을 포함해 Android 앱을 다시 빌드해야 합니다.',
      );
    }
    const raw = JSON.stringify(
      parseCloudRecord(JSON.stringify(record), !editLocation),
    );
    const result = await (editLocation
      ? bridge.openCloudMap(raw)
      : bridge.openCloudNavigation(raw));
    if (result) {
      setRecord(parseCloudRecord(result));
      setMessage(
        editLocation
          ? '탐색 위치를 연결했습니다. 미니맵으로 찾기를 실행하세요.'
          : '복원 결과를 기록했습니다. 실제 오차는 현장 기준점과 비교하세요.',
      );
    }
  }
  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>Cloud Anchor 기기 간 복원 실험</Text>
      <Text style={styles.text}>{message}</Text>
      <Text style={styles.note}>
        터치 배치·드래그 조정 → 주변 여러 각도 촬영 → GOOD 품질 유지 → Cloud
        저장. 품질별 비교는 AR 화면의 ‘현재 품질로 저장 허용’을 선택하세요.
      </Text>
      <Text style={styles.note}>
        앵커 수명은 1일입니다. 저장 후 지도에서 탐색 위치를 연결하면 미니맵으로
        찾을 수 있습니다. 지도 위치는 근처 안내용이며 최종 핀은 Cloud로
        복원합니다.
      </Text>
      <Button
        title="새 Cloud Anchor 배치"
        disabled={busy || !configured}
        onPress={() => run(() => open(false))}
      />
      <TextInput
        style={styles.input}
        multiline
        value={input}
        onChangeText={setInput}
        editable={!busy}
        placeholder="다른 기기에서 공유한 Cloud JSON 붙여넣기"
        placeholderTextColor="#9ca3af"
        maxLength={65537}
        accessibilityLabel="Cloud Anchor JSON"
      />
      <Button
        title="JSON 불러오기"
        disabled={busy || !input.trim()}
        onPress={() =>
          run(async () => {
            setRecord(parseCloudRecord(input));
            setMessage(
              '기록을 불러왔습니다. 작성한 장소에서 복원을 실행하세요.',
            );
          })
        }
      />
      {record && (
        <View style={styles.group}>
          <Text style={styles.text}>
            작성 기기: {record.hostDeviceLabel}
            {'\n'}
            작성 Hit: {record.hitType} / Depth Hit 허용:{' '}
            {String(record.depthHitAllowed)}
            {'\n'}
            특징 품질: {record.featureMapQuality}
            {'\n'}
            저장 기준:{' '}
            {record.qualityPolicy === 'DIAGNOSTIC_CURRENT_QUALITY'
              ? '현재 품질 비교 실험'
              : 'GOOD 1초 유지'}
            {'\n'}
            예상 만료: {record.expiresAtEstimate}
            {'\n'}
            최근 동작: {record.operation.type} /{' '}
            {(record.operation.durationMs / 1000).toFixed(1)}초{'\n'}
            최근 기기: {record.operation.deviceLabel}
          </Text>
          {record.restorationEstimate && (
            <Text style={styles.text}>
              AR 참고 차이: 수평{' '}
              {record.restorationEstimate.horizontalOffsetMeters.toFixed(2)}m /
              수직 {record.restorationEstimate.verticalOffsetMeters.toFixed(2)}m
              {'\n'}
              기준점 Hit: {record.restorationEstimate.referenceHitType} / 측량값
              아님
            </Text>
          )}
          <Text style={styles.note}>
            기기 간 실제 복원 정확도: 미검증. 같은 모델 이름이나 Cloud 성공
            응답만으로 성공 판정하지 않습니다.
          </Text>
          <Button
            title={
              record.discoveryLocation
                ? '탐색용 지도 위치 수정'
                : '1. 탐색용 지도 위치 연결'
            }
            disabled={busy || !mapConfigured}
            onPress={() => run(() => navigate(true))}
          />
          {!mapConfigured && (
            <Text style={styles.note}>
              카카오 키 설정 후 Android 재빌드가 필요합니다.
            </Text>
          )}
          {record.discoveryLocation && (
            <Text style={styles.note}>
              탐색 위치: {record.discoveryLocation.latitude.toFixed(6)},{' '}
              {record.discoveryLocation.longitude.toFixed(6)}
              {'\n'}지도에서 직접 선택 · 위치 오차 미상 · AR 정밀 좌표와 별도
            </Text>
          )}
          <Button
            title="2. 미니맵으로 찾기 · AR 방향 안내"
            disabled={busy || !configured || !record.discoveryLocation}
            onPress={() => run(() => navigate(false))}
          />
          <Button
            title="이 Cloud Anchor 복원·비교"
            disabled={busy || !configured}
            onPress={() => run(() => open(true))}
          />
          <Button
            title="Cloud JSON 공유"
            disabled={busy}
            onPress={() =>
              run(async () => {
                await Share.share({ message: JSON.stringify(record, null, 2) });
              })
            }
          />
          <Text selectable style={styles.json}>
            {JSON.stringify(record, null, 2)}
          </Text>
        </View>
      )}
      <Button title="처음으로" disabled={busy} onPress={onBack} />
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  content: { padding: 20, gap: 16 },
  title: { color: '#fff', fontSize: 21, fontWeight: 'bold' },
  text: { color: '#fff', lineHeight: 23 },
  note: { color: '#cbd5e1', lineHeight: 22 },
  input: {
    color: '#fff',
    backgroundColor: '#1f2937',
    minHeight: 110,
    maxHeight: 200,
    padding: 12,
    textAlignVertical: 'top',
  },
  group: { gap: 14 },
  json: { color: '#cbd5e1', fontSize: 11, fontFamily: 'monospace' },
});

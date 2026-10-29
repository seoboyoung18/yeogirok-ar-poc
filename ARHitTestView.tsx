import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import {
  AppState,
  Button,
  Modal,
  PixelRatio,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import {
  ViroARScene,
  ViroARSceneNavigator,
  ViroTrackingStateConstants,
} from '@reactvision/react-viro';
import type { ViroARHitTestResult } from '@reactvision/react-viro';
import ARTipMarker from './ARTipMarker';
import {
  createPlacementRecord,
  moveSelection,
  selectPlaneHit,
} from './placement';
import type { PlacementRecord, PlacementSelection, Point3 } from './placement';

type SceneContextValue = {
  sceneRef: RefObject<ViroARScene | null>;
  updateTracking: (state: number, reason: number) => void;
  selection: PlacementSelection | null;
  confirmed: boolean;
  onDrag: (position: Point3) => void;
};
const SceneContext = createContext<SceneContextValue | null>(null);

function HitTestScene() {
  const context = useContext(SceneContext);
  if (!context) {
    return <ViroARScene />;
  }
  return (
    <ViroARScene
      ref={context.sceneRef}
      anchorDetectionTypes={['PlanesHorizontal', 'PlanesVertical']}
      onTrackingUpdated={context.updateTracking}
    >
      {context.selection && (
        <ARTipMarker
          position={context.selection.position}
          confirmed={context.confirmed}
          onDrag={context.onDrag}
        />
      )}
    </ViroARScene>
  );
}

function formatVector(values: number[]) {
  return values.map(value => value.toFixed(3)).join(', ');
}
const now = () => new Date().toISOString();

export default function ARHitTestView() {
  const sceneRef = useRef<ViroARScene | null>(null);
  const navigatorRef = useRef<ViroARSceneNavigator | null>(null);
  const sessionId = useRef(
    `local-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const trackingRef = useRef(0);
  const generationRef = useRef(0);
  const pendingRef = useRef(false);
  const activeRef = useRef(AppState.currentState === 'active');
  const selectionRef = useRef<PlacementSelection | null>(null);
  const confirmedRef = useRef<PlacementRecord | null>(null);
  const [tracking, setTracking] = useState({ state: 0, reason: 0 });
  const [selection, setSelection] = useState<PlacementSelection | null>(null);
  const [confirmed, setConfirmed] = useState<PlacementRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<'record' | 'geo' | null>(null);
  const [diagnostic, setDiagnostic] = useState('준비 상태를 확인하는 중…');
  const [message, setMessage] = useState(
    '바닥이나 책상을 천천히 비춘 뒤 터치하세요.',
  );
  const normal = tracking.state === ViroTrackingStateConstants.TRACKING_NORMAL;

  function clearPlacement() {
    generationRef.current += 1;
    selectionRef.current = null;
    confirmedRef.current = null;
    setSelection(null);
    setConfirmed(null);
  }

  useEffect(() => {
    activeRef.current = AppState.currentState === 'active';
    const subscription = AppState.addEventListener('change', state => {
      activeRef.current = state === 'active';
      clearPlacement();
      setBusy(pendingRef.current);
      setDialog(null);
      setMessage('화면 전환으로 위치를 초기화했습니다. 다시 배치하세요.');
    });
    return () => {
      activeRef.current = false;
      generationRef.current += 1;
      subscription.remove();
    };
  }, []);

  function updateTracking(state: number, reason: number) {
    trackingRef.current = state;
    setTracking({ state, reason });
    if (state !== ViroTrackingStateConstants.TRACKING_NORMAL) {
      clearPlacement();
      setMessage('추적 정상 상태가 되면 다시 배치하세요.');
    }
  }

  async function hitTest(x: number, y: number) {
    const scene = sceneRef.current;
    if (
      !activeRef.current ||
      !scene ||
      pendingRef.current ||
      selectionRef.current
    ) {
      return;
    }
    if (trackingRef.current !== ViroTrackingStateConstants.TRACKING_NORMAL) {
      setMessage('추적이 정상 상태가 된 뒤 터치하세요.');
      return;
    }
    const generation = generationRef.current;
    const isCurrent = () =>
      activeRef.current && generation === generationRef.current;
    pendingRef.current = true;
    setBusy(true);
    setMessage('터치 지점 확인 중…');
    try {
      // Same viewport bounds: RN dp -> Android physical pixels.
      const results: ViroARHitTestResult[] =
        await scene.performARHitTestWithPoint(
          x * PixelRatio.get(),
          y * PixelRatio.get(),
        );
      if (!isCurrent()) {
        return;
      }
      const selected = selectPlaneHit(results, generation, now());
      if (!selected) {
        setMessage(
          `후보 ${results.length}개 / 인식된 평면 내부 결과 없음. 주변을 더 비춰 주세요.`,
        );
        return;
      }
      selectionRef.current = selected;
      setSelection(selected);
      setMessage('핀을 잡아 끌어 위치를 조정한 뒤 ‘위치 확정’을 누르세요.');
    } catch (error) {
      if (isCurrent()) {
        setMessage(
          `Hit-test 오류: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    } finally {
      pendingRef.current = false;
      if (activeRef.current) {
        setBusy(false);
      }
    }
  }

  function onDrag(position: Point3) {
    const current = selectionRef.current;
    if (
      !activeRef.current ||
      !current ||
      confirmedRef.current ||
      current.generation !== generationRef.current ||
      trackingRef.current !== ViroTrackingStateConstants.TRACKING_NORMAL
    ) {
      return;
    }
    const moved = moveSelection(current, position, now());
    if (moved) {
      selectionRef.current = moved;
      setSelection(moved);
      setMessage('위치 조정 중입니다. 손을 떼고 ‘위치 확정’을 누르세요.');
    }
  }

  function confirmPlacement() {
    if (!selectionRef.current || !activeRef.current || pendingRef.current) {
      return;
    }
    try {
      const record = createPlacementRecord(
        selectionRef.current,
        sessionId.current,
        generationRef.current,
        trackingRef.current === ViroTrackingStateConstants.TRACKING_NORMAL,
        now(),
      );
      confirmedRef.current = record;
      setConfirmed(record);
      setMessage(
        '핀 끝의 위치를 확정했습니다. 지리 좌표 변환은 아직 연결 전입니다.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function checkGeospatialSetup() {
    const navigator = navigatorRef.current;
    if (!navigator) {
      return;
    }
    setDialog('geo');
    setDiagnostic('준비 상태를 확인하는 중…');
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const status = await Promise.race([
        navigator.arSceneNavigator.getGeospatialSetupStatus(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('진단 응답 시간 초과')),
            10000,
          );
        }),
      ]);
      if (!activeRef.current) {
        return;
      }
      // Only show booleans. Never display or export credentials.
      setDiagnostic(
        [
          `Geospatial 지원: ${
            status.geospatialSupported ? '지원' : '미확인 또는 미지원'
          }`,
          `위치 서비스: ${
            status.locationServicesAvailable
              ? '사용 가능'
              : '미확인 또는 사용 불가'
          }`,
          `API 키 설정 신호: ${status.apiKeyConfigured ? '있음' : '없음'}`,
          status.error
            ? '진단 오류가 있습니다. 이 결과만으로 지원 여부를 확정하지 않습니다.'
            : '',
          '',
          '현재 클라우드 제공자: none / 지리 좌표 모드 활성화 전',
          '위 항목은 설정 진단이며 인증·Earth 추적 성공을 보장하지 않습니다.',
          '',
          'Viro 3.0.3 공개 API에는 최종 Pose → 지리 좌표 변환이 없습니다.',
          '같은 AR 세션에서 팁 좌표를 변환하는 네이티브 연결이 필요합니다.',
          '카메라 GPS를 팁 위치로 대신 저장하지 않습니다.',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    } catch (error) {
      if (activeRef.current) {
        setDiagnostic(error instanceof Error ? error.message : String(error));
      }
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  async function shareRecord() {
    const record = confirmedRef.current;
    if (!record || !activeRef.current) {
      return;
    }
    try {
      await Share.share({
        title: '여기록 AR 위치 검증 기록',
        message: JSON.stringify(record, null, 2),
      });
    } catch {
      if (activeRef.current) {
        setMessage('기록 공유 창을 열지 못했습니다.');
      }
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.info}>
        <Text style={styles.text}>
          {normal ? '추적 정상' : '추적 준비 또는 제한'}
          {` (상태 ${tracking.state}, 사유 ${tracking.reason})`}
        </Text>
        <Text style={styles.text}>{message}</Text>
        {selection && (
          <Text style={styles.text}>
            {confirmed ? '확정' : '미확정'} 핀 끝 XYZ (m):{' '}
            {formatVector(selection.position)}
          </Text>
        )}
        <Text style={styles.note}>
          세션 좌표 / 위도·경도·정확도 미측정 / 공유 앵커 미생성
        </Text>
      </View>
      <View style={styles.camera}>
        <SceneContext.Provider
          value={{
            sceneRef,
            updateTracking,
            selection,
            confirmed: !!confirmed,
            onDrag,
          }}
        >
          <ViroARSceneNavigator
            ref={navigatorRef}
            style={styles.camera}
            initialScene={{ scene: HitTestScene }}
            provider="none"
          />
        </SceneContext.Provider>
        {!selection && (
          <Pressable
            style={StyleSheet.absoluteFill}
            accessibilityLabel="핀을 배치할 평면을 터치"
            onPress={event => {
              const { locationX, locationY } = event.nativeEvent;
              hitTest(locationX, locationY);
            }}
          />
        )}
      </View>
      <View style={styles.controls}>
        <View style={styles.row}>
          <Button
            title="위치 확정"
            disabled={!selection || !!confirmed || !normal || busy}
            onPress={confirmPlacement}
          />
          <Button
            title="다시 배치"
            disabled={busy}
            onPress={() => {
              clearPlacement();
              setMessage('새 위치를 터치하세요.');
            }}
          />
          <Button
            title="기록 보기"
            disabled={!confirmed}
            onPress={() => setDialog('record')}
          />
        </View>
        <Button
          title="지리 좌표 준비 상태 확인"
          onPress={checkGeospatialSetup}
        />
      </View>
      <Modal
        visible={dialog !== null}
        animationType="slide"
        onRequestClose={() => setDialog(null)}
      >
        <View style={styles.modal}>
          <Text style={styles.heading}>
            {dialog === 'geo' ? '지리 좌표 준비 상태' : '위치 검증 기록'}
          </Text>
          <ScrollView style={styles.details}>
            <Text selectable style={styles.text}>
              {dialog === 'geo'
                ? diagnostic
                : confirmed
                ? JSON.stringify(confirmed, null, 2)
                : '위치가 초기화됐습니다. 다시 배치해 주세요.'}
            </Text>
          </ScrollView>
          {dialog === 'record' && (
            <Button
              title="JSON 기록 공유"
              disabled={!confirmed}
              onPress={shareRecord}
            />
          )}
          <Button title="닫기" onPress={() => setDialog(null)} />
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  camera: { flex: 1 },
  info: { paddingHorizontal: 16, paddingBottom: 10, gap: 5 },
  text: { color: '#ffffff', fontSize: 13, lineHeight: 20 },
  note: { color: '#cbd5e1', fontSize: 11 },
  controls: { padding: 8, gap: 4 },
  row: { flexDirection: 'row', justifyContent: 'space-around' },
  modal: {
    flex: 1,
    backgroundColor: '#111827',
    padding: 24,
    paddingTop: 48,
    gap: 12,
  },
  heading: { color: '#ffffff', fontSize: 20, fontWeight: 'bold' },
  details: { flex: 1 },
});

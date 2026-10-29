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
import { compareReference, parseGeoRecord } from './geospatial';
import type { GeoRecord, ReferencePoint } from './geospatial';
import validationRecordPrefill from './validationRecordPrefill';

type Status = {
  arcoreKeyConfigured: boolean;
  kakaoKeyConfigured: boolean;
  arcoreVersion: string;
  deviceLabel?: string;
};
type Bridge = {
  getStatus(): Promise<Status>;
  getLastRecord(): Promise<string | null>;
  saveRecord(raw: string): Promise<string>;
  clearLastRecord(): Promise<void>;
  openGeo(restoreJson: string | null): Promise<string | null>;
  openMap(recordJson: string): Promise<string | null>;
};
const bridge = NativeModules.GeoValidation as Bridge | undefined;

export default function GeoValidationPanel({ onBack }: { onBack: () => void }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [record, setRecord] = useState<GeoRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    '실외에서 팁을 배치하고 지리 좌표를 측정하세요.',
  );
  const [importText, setImportText] = useState(
    __DEV__ ? validationRecordPrefill : '',
  );
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [sourceLabel, setSourceLabel] = useState('직접 입력');
  const [uncertainty, setUncertainty] = useState('');
  const [referenceSource, setReferenceSource] =
    useState<ReferencePoint['source']>('manual-coordinate');
  const [showSourceOptions, setShowSourceOptions] = useState(false);
  const surveyed = referenceSource === 'surveyed';
  const [referenceMessage, setReferenceMessage] = useState('');
  const [showJson, setShowJson] = useState(false);
  const [offset, setOffset] = useState('');
  const [verticalOffset, setVerticalOffset] = useState('');
  const [measurementMethod, setMeasurementMethod] = useState('');
  const [deviceLabel, setDeviceLabel] = useState('');
  const [restorationMessage, setRestorationMessage] = useState('');
  const savedObservation = record?.restorationObservation;
  const currentRecordId = record?.recordId;

  useEffect(() => {
    // Only saved manual observations belong in manual fields; AR estimates stay separate.
    setOffset(
      savedObservation ? String(savedObservation.horizontalOffsetMeters) : '',
    );
    setVerticalOffset(
      savedObservation?.verticalOffsetMeters != null
        ? String(savedObservation.verticalOffsetMeters)
        : '',
    );
    setMeasurementMethod(savedObservation?.method ?? '');
    setDeviceLabel(savedObservation?.deviceLabel ?? status?.deviceLabel ?? '');
  }, [currentRecordId, savedObservation, status?.deviceLabel]);

  useEffect(() => {
    let active = true;
    if (!bridge) {
      setMessage(
        '네이티브 기능이 아직 설치되지 않았습니다. Android 앱을 다시 빌드하세요.',
      );
      return;
    }
    Promise.all([bridge.getStatus(), bridge.getLastRecord()])
      .then(([configuration, saved]) => {
        if (!active) {
          return;
        }
        setStatus(configuration);
        if (saved) {
          setRecord(parseGeoRecord(saved));
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

  async function run(
    action: () => Promise<void>,
    onError?: (detail: string) => void,
  ) {
    if (busy) {
      return;
    }
    setBusy(true);
    try {
      await action();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      setMessage(detail);
      onError?.(detail);
    } finally {
      setBusy(false);
    }
  }
  async function capture(restore: boolean) {
    if (!bridge) {
      throw new Error('Android 재빌드가 필요합니다.');
    }
    const result = await bridge.openGeo(
      restore && record ? JSON.stringify(record) : null,
    );
    if (result) {
      setRestorationMessage('');
      setRecord(parseGeoRecord(result));
      setMessage(
        restore
          ? '복원 기록을 저장했습니다. 원래 지점을 선택했다면 AR 자동 추정값을 확인하세요.'
          : '팁의 지리 좌표를 받았습니다. 지도에서 기준점과 비교하세요.',
      );
    } else {
      setMessage('측정을 취소했습니다. 기존 기록은 유지합니다.');
    }
  }
  function selectReferenceSource(source: 'manual-coordinate' | 'surveyed') {
    setReferenceSource(source);
    if (source !== referenceSource || !sourceLabel.trim()) {
      setSourceLabel(source === 'surveyed' ? '측량 기준점' : '직접 입력');
    }
    setShowSourceOptions(false);
    setReferenceMessage(
      source === 'surveyed'
        ? '출처를 채웠습니다. 실제 측량 좌표·불확실성을 입력하고 출처에 측량점 번호를 덧붙여 주세요.'
        : '출처를 채웠습니다. 비교할 지점의 위도·경도를 입력해 주세요.',
    );
  }

  function fillReferenceForm(reference: ReferencePoint) {
    setLatitude(String(reference.latitude));
    setLongitude(String(reference.longitude));
    setSourceLabel(reference.sourceLabel);
    setUncertainty(
      reference.uncertaintyMeters === null
        ? ''
        : String(reference.uncertaintyMeters),
    );
    setReferenceSource(reference.source);
    setShowSourceOptions(false);
    setReferenceMessage('저장된 기준점의 좌표와 출처를 불러왔습니다.');
  }

  function markCoordinateEdited() {
    if (referenceSource === 'map-tap') {
      setReferenceSource('manual-coordinate');
      setSourceLabel('카카오 지도 비교점에서 직접 수정');
    }
    setReferenceMessage('');
  }

  async function saveReference() {
    if (!record || !bridge) {
      return;
    }
    if (!latitude.trim() || !longitude.trim() || !sourceLabel.trim()) {
      throw new Error('기준점 위도·경도와 출처를 입력하세요.');
    }
    if (!Number.isFinite(Number(latitude)) || Math.abs(Number(latitude)) > 90) {
      throw new Error('위도는 -90~90 사이의 숫자로 입력하세요.');
    }
    if (
      !Number.isFinite(Number(longitude)) ||
      Math.abs(Number(longitude)) > 180
    ) {
      throw new Error('경도는 -180~180 사이의 숫자로 입력하세요.');
    }
    if (
      uncertainty.trim() &&
      (!Number.isFinite(Number(uncertainty)) || Number(uncertainty) < 0)
    ) {
      throw new Error(
        '기준점 불확실성은 0 이상의 숫자로 입력하거나 비워 두세요.',
      );
    }
    if (surveyed && !uncertainty.trim()) {
      throw new Error('측량 기준점은 알려진 측량 불확실성(m)도 입력하세요.');
    }
    const reference: ReferencePoint = {
      latitude: Number(latitude),
      longitude: Number(longitude),
      source: referenceSource,
      sourceLabel: sourceLabel.trim(),
      uncertaintyMeters: uncertainty.trim() ? Number(uncertainty) : null,
      capturedAt: new Date().toISOString(),
    };
    const next = parseGeoRecord(JSON.stringify({ ...record, reference }));
    await bridge.saveRecord(JSON.stringify(next));
    setRecord(next);
    setMessage('기준점과의 수평거리 차이를 계산했습니다.');
    setReferenceMessage(
      '기준점을 저장했습니다. 아래에서 계산 결과를 확인하세요.',
    );
  }
  const comparison = record ? compareReference(record) : null;
  const exported = record
    ? JSON.stringify({ ...record, comparison }, null, 2)
    : '';
  const disabled = busy || !bridge;
  return (
    <ScrollView
      contentContainerStyle={styles.container}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.title}>지리 좌표·지도 검증</Text>
      <Text style={styles.text}>{message}</Text>
      {status && (
        <Text style={styles.note}>
          ARCore 키: {status.arcoreKeyConfigured ? '설정됨' : '필요'} / 카카오
          키: {status.kakaoKeyConfigured ? '설정됨' : '필요'}
          {'\n'}앱 ARCore SDK: {status.arcoreVersion}
          {'\n'}키 설정 여부이며 인증 성공을 뜻하지 않습니다.
        </Text>
      )}
      <Button
        title="새 AR 팁 위치 측정"
        disabled={disabled}
        onPress={() => run(() => capture(false))}
      />
      <Button
        title="저장 좌표로 AR 복원"
        disabled={disabled || !record}
        onPress={() => run(() => capture(true))}
      />
      <Button
        title="카카오 지도에서 비교"
        disabled={disabled || !record}
        onPress={() =>
          run(async () => {
            if (!bridge || !record) {
              return;
            }
            const result = await bridge.openMap(JSON.stringify(record));
            if (result) {
              const updated = parseGeoRecord(result);
              setRecord(updated);
              if (updated.reference) {
                fillReferenceForm(updated.reference);
              }
            }
          })
        }
      />
      {record && (
        <View style={styles.card}>
          <Text style={styles.text}>
            팁: {record.tip.latitude.toFixed(7)},{' '}
            {record.tip.longitude.toFixed(7)}
          </Text>
          <Text style={styles.text}>
            고도: {record.tip.altitude.toFixed(2)}m (WGS84 타원체)
          </Text>
          <Text style={styles.text}>
            추정 정확도(68%): 수평 {record.accuracy.horizontalMeters.toFixed(2)}
            m / 수직 {record.accuracy.verticalMeters.toFixed(2)}m / 방향{' '}
            {record.accuracy.yawDegrees.toFixed(1)}°
          </Text>
          <Text style={styles.note}>측정 시각: {record.confirmedAt}</Text>
          <Text style={styles.note}>
            추정 정확도는 실제 오차가 아닙니다. 기기 간 복원 검증은
            미완료입니다.
          </Text>
          {comparison && (
            <>
              <Text style={styles.text}>
                기준점과 수평거리(구면근사):{' '}
                {comparison.horizontalSeparationMeters.toFixed(2)}m
              </Text>
              <Text style={styles.note}>
                기준점 불확실성:{' '}
                {comparison.referenceUncertaintyMeters === null
                  ? '미상'
                  : `${comparison.referenceUncertaintyMeters}m`}
              </Text>
              <Text style={styles.note}>{comparison.interpretation}</Text>
            </>
          )}
        </View>
      )}
      {record?.restoredFrom && (
        <View style={styles.card}>
          <Text style={styles.subtitle}>AR 복원 위치 확인</Text>
          {record.restorationEstimate ? (
            <View style={styles.card}>
              <Text style={styles.text}>자동 기록된 AR 추정값</Text>
              <Text style={styles.text}>
                수평 어긋남:{' '}
                {record.restorationEstimate.horizontalOffsetMeters.toFixed(2)}m
              </Text>
              <Text style={styles.text}>
                수직 어긋남:{' '}
                {record.restorationEstimate.verticalOffsetMeters.toFixed(2)}m
                (위쪽 + / 아래쪽 -)
              </Text>
              <Text style={styles.note}>
                측정 방법: 원래 지점을 터치해 AR 평면 위 두 점 비교
              </Text>
              <Text style={styles.note}>
                기기: {record.restorationEstimate.deviceLabel}
              </Text>
              <Text style={styles.note}>
                시각: {record.restorationEstimate.estimatedAt}
              </Text>
              <Text style={styles.note}>
                평면 인식·터치·추적 오차가 포함된 추정값입니다. 줄자 실측이나
                실제 정확도의 보증이 아닙니다.
              </Text>
            </View>
          ) : (
            <Text style={styles.note}>
              자동 기록하려면 ‘저장 좌표로 AR 복원’을 열고 원래 핀을 놓았던 실제
              지점을 터치한 뒤 확정하세요. 복원된 주황 핀은 이동하지 않고, 선택
              지점은 초록 점으로 표시됩니다.
            </Text>
          )}
          <Text style={styles.subtitle}>별도 실측 기록 (선택)</Text>
          <Text style={styles.note}>
            줄자 등으로 별도 측정했다면 입력하세요. AR 추정값은 실측 입력란에
            복사하지 않습니다. 기기명은 자동으로 채웁니다.
          </Text>
          <TextInput
            style={styles.input}
            placeholder="수평 어긋남 (m)"
            placeholderTextColor="#94a3b8"
            value={offset}
            onChangeText={setOffset}
          />
          <TextInput
            style={styles.input}
            placeholder="수직 어긋남 (m, 위쪽 + / 아래쪽 -, 선택)"
            placeholderTextColor="#94a3b8"
            value={verticalOffset}
            onChangeText={setVerticalOffset}
          />
          <Button
            title="측정 방법: 줄자"
            onPress={() =>
              setMeasurementMethod(
                '원래 표시점과 복원된 핀 끝 사이를 줄자로 측정',
              )
            }
          />
          <Button
            title="측정 방법: 눈대중"
            onPress={() =>
              setMeasurementMethod('눈대중으로 추정 (정밀 실측 아님)')
            }
          />
          <TextInput
            style={styles.input}
            placeholder="측정 방법 (예: 바닥 표시점부터 줄자로 측정)"
            placeholderTextColor="#94a3b8"
            value={measurementMethod}
            onChangeText={setMeasurementMethod}
          />
          <TextInput
            style={styles.input}
            placeholder="복원한 기기 이름"
            placeholderTextColor="#94a3b8"
            value={deviceLabel}
            onChangeText={setDeviceLabel}
          />
          <Button
            title="복원 실측 기록"
            disabled={disabled}
            onPress={() =>
              run(async () => {
                if (!offset.trim() || !bridge) {
                  throw new Error(
                    '별도로 측정한 수평 어긋남을 입력하세요. AR 자동 추정만 확인하려면 이 입력은 필요 없습니다.',
                  );
                }
                if (!measurementMethod.trim() || !deviceLabel.trim()) {
                  throw new Error('측정 방법을 선택하고 기기명을 확인하세요.');
                }
                const next = parseGeoRecord(
                  JSON.stringify({
                    ...record,
                    restorationObservation: {
                      horizontalOffsetMeters: Number(offset),
                      verticalOffsetMeters: verticalOffset.trim()
                        ? Number(verticalOffset)
                        : null,
                      method: measurementMethod.trim(),
                      deviceLabel: deviceLabel.trim(),
                      observedAt: new Date().toISOString(),
                    },
                  }),
                );
                await bridge.saveRecord(JSON.stringify(next));
                setRecord(next);
                setMessage('별도 실측 기록을 저장했습니다.');
                setRestorationMessage('별도 실측 기록을 저장했습니다.');
              }, setRestorationMessage)
            }
          />
          {!!restorationMessage && (
            <Text style={styles.text} accessibilityLiveRegion="polite">
              {restorationMessage}
            </Text>
          )}
          {record.restorationObservation && (
            <Text style={styles.text}>
              저장된 수평 어긋남:{' '}
              {record.restorationObservation.horizontalOffsetMeters}m /{' '}
              {record.restorationObservation.deviceLabel}
            </Text>
          )}
        </View>
      )}
      <Text style={styles.subtitle}>알고 있는 기준점 좌표 입력</Text>
      <Text style={styles.note}>
        출처 버튼에서 종류를 고르면 출처 설명이 자동으로 채워집니다. 저장된
        기준점을 불러오면 위도·경도도 함께 채워집니다. 지도에서 비교점을
        선택하고 돌아와도 자동으로 반영됩니다.
      </Text>
      {!record && (
        <Text style={styles.note}>먼저 AR 팁 위치를 측정하고 확정하세요.</Text>
      )}
      <TextInput
        style={styles.input}
        placeholder="위도"
        placeholderTextColor="#94a3b8"
        value={latitude}
        onChangeText={value => {
          setLatitude(value);
          markCoordinateEdited();
        }}
      />
      <TextInput
        style={styles.input}
        placeholder="경도"
        placeholderTextColor="#94a3b8"
        value={longitude}
        onChangeText={value => {
          setLongitude(value);
          markCoordinateEdited();
        }}
      />
      <TextInput
        style={styles.input}
        placeholder="출처 (측량점 번호, 지도명 등)"
        placeholderTextColor="#94a3b8"
        value={sourceLabel}
        onChangeText={value => {
          setSourceLabel(value);
          setReferenceMessage('');
        }}
      />
      <TextInput
        style={styles.input}
        placeholder="기준점 불확실성 m (모르면 비워두기)"
        placeholderTextColor="#94a3b8"
        value={uncertainty}
        onChangeText={value => {
          setUncertainty(value);
          setReferenceMessage('');
        }}
      />
      <Button
        title={
          referenceSource === 'map-tap'
            ? '출처: 카카오 지도 선택 (눌러 선택)'
            : surveyed
            ? '출처: 측량 기준점 (눌러 선택)'
            : '출처: 직접 입력 (눌러 선택)'
        }
        disabled={busy}
        onPress={() => setShowSourceOptions(!showSourceOptions)}
      />
      {showSourceOptions && (
        <View style={styles.card}>
          <Button
            title="직접 입력"
            onPress={() => selectReferenceSource('manual-coordinate')}
          />
          <Button
            title="측량 기준점"
            onPress={() => selectReferenceSource('surveyed')}
          />
          <Button
            title="저장된 기준점 불러오기"
            disabled={!record?.reference}
            onPress={() => {
              if (record?.reference) {
                fillReferenceForm(record.reference);
              }
            }}
          />
          {!record?.reference && (
            <Text style={styles.note}>
              저장된 기준점이 없습니다. ‘카카오 지도에서 비교’에서 비교점을 먼저
              선택하세요.
            </Text>
          )}
        </View>
      )}
      <Button
        title="기준점 반영·거리 계산"
        disabled={disabled || !record}
        onPress={() =>
          run(async () => {
            setReferenceMessage('기준점 저장·거리 계산 중…');
            await saveReference();
          }, setReferenceMessage)
        }
      />
      {!!referenceMessage && (
        <Text style={styles.text} accessibilityLiveRegion="polite">
          {referenceMessage}
        </Text>
      )}
      {record?.reference && comparison && (
        <View style={styles.card}>
          <Text style={styles.text}>
            저장된 기준점과 수평거리:{' '}
            {comparison.horizontalSeparationMeters.toFixed(2)}m
          </Text>
          <Text style={styles.note}>
            기준점: {record.reference.latitude.toFixed(7)},{' '}
            {record.reference.longitude.toFixed(7)}
          </Text>
          <Text style={styles.note}>출처: {record.reference.sourceLabel}</Text>
          <Text style={styles.note}>{comparison.interpretation}</Text>
          <Text style={styles.note}>
            위 입력란을 수정했다면 ‘기준점 반영·거리 계산’을 눌러야 결과에
            반영됩니다.
          </Text>
        </View>
      )}
      <Text style={styles.subtitle}>기록 내보내기·다른 기기에서 가져오기</Text>
      <Button
        title={showJson ? 'JSON 숨기기' : 'JSON 보기'}
        disabled={!record}
        onPress={() => setShowJson(!showJson)}
      />
      {showJson && (
        <Text selectable style={styles.json}>
          {exported}
        </Text>
      )}
      <Button
        title="기록 공유"
        disabled={busy || !record}
        onPress={() =>
          run(async () => {
            await Share.share({
              title: '여기록 지리 좌표 검증',
              message: exported,
            });
          })
        }
      />
      {__DEV__ && !!validationRecordPrefill && (
        <>
          <Text style={styles.note}>
            전달받은 테스트 JSON을 입력란에 미리 채웠습니다. 아래 ‘JSON 검증 후
            가져오기’를 누르세요. 기존에 기록된 오차는 이전 기기의 결과이며, 이
            기기에서는 새로 복원해야 합니다.
          </Text>
          <Button
            title="전달받은 JSON 다시 채우기"
            disabled={busy}
            onPress={() => setImportText(validationRecordPrefill)}
          />
        </>
      )}
      <TextInput
        style={[styles.input, styles.multiline]}
        multiline
        maxLength={65536}
        placeholder="다른 기기에서 받은 지리 좌표 JSON 붙여넣기"
        placeholderTextColor="#94a3b8"
        value={importText}
        onChangeText={setImportText}
      />
      <Button
        title="JSON 검증 후 가져오기"
        disabled={disabled || !importText.trim()}
        onPress={() =>
          run(async () => {
            if (!bridge) {
              return;
            }
            const imported = parseGeoRecord(importText);
            await bridge.saveRecord(JSON.stringify(imported));
            setRecord(imported);
            setMessage(
              '기록을 가져왔습니다. 같은 장소에서 AR 복원을 실행하세요.',
            );
          })
        }
      />
      <Button
        title="이 기기의 검증 기록 지우기"
        disabled={disabled || !record}
        onPress={() =>
          run(async () => {
            await bridge?.clearLastRecord();
            setRecord(null);
            setShowJson(false);
            setImportText('');
          })
        }
      />
      <Text style={styles.note}>
        실제 위치 기록을 Git에 올리지 마세요. 키는 android/local.properties에서
        설정합니다.
      </Text>
      <Button title="처음으로" disabled={busy} onPress={onBack} />
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  container: { padding: 16, gap: 12 },
  title: { color: '#ffffff', fontSize: 22, fontWeight: 'bold' },
  subtitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: 'bold',
    marginTop: 12,
  },
  text: { color: '#ffffff', fontSize: 14, lineHeight: 22 },
  note: { color: '#cbd5e1', fontSize: 12, lineHeight: 19 },
  card: { backgroundColor: '#1e293b', padding: 12, borderRadius: 8, gap: 6 },
  input: {
    color: '#ffffff',
    borderWidth: 1,
    borderColor: '#64748b',
    borderRadius: 6,
    padding: 10,
  },
  multiline: { minHeight: 100, textAlignVertical: 'top' },
  json: { color: '#cbd5e1', fontFamily: 'monospace', fontSize: 11 },
});

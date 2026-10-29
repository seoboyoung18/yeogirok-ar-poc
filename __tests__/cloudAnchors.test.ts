import { parseCloudRecord } from '../cloudAnchors';

const discovery = () => ({
  latitude: 37.5,
  longitude: 127.0,
  source: 'MAP_SELECTED',
  uncertaintyMeters: null,
  capturedAt: '2026-10-29T10:01:00Z',
});

test('manual discovery coordinate survives sharing without replacing Cloud pose or GPS', () => {
  const record = parseCloudRecord(
    JSON.stringify({ ...fixture(), discoveryLocation: discovery() }),
  );
  expect(record.discoveryLocation).toEqual(discovery());
  expect(record.geospatial).toBeNull();
  expect(record.anchorId).toBe(fixture().anchorId);
  expect(record.localPose).toEqual(fixture().localPose);
  expect(parseCloudRecord(JSON.stringify(record)).discoveryLocation).toEqual(
    discovery(),
  );
  expect(
    parseCloudRecord(JSON.stringify(fixture())).discoveryLocation,
  ).toBeUndefined();
});
test.each([
  { latitude: 91 },
  { longitude: -181 },
  { latitude: '37.5' },
  { longitude: null },
  { source: 'DEVICE_GPS' },
  { uncertaintyMeters: 0 },
  { capturedAt: 'invalid' },
])('rejects invalid or misleading discovery location %j', change => {
  expect(() =>
    parseCloudRecord(
      JSON.stringify({
        ...fixture(),
        discoveryLocation: { ...discovery(), ...change },
      }),
    ),
  ).toThrow();
});
test('rejects a null discovery location instead of manufacturing a map point', () => {
  expect(() =>
    parseCloudRecord(JSON.stringify({ ...fixture(), discoveryLocation: null })),
  ).toThrow();
});

const fixture = () => ({
  schemaVersion: 1,
  kind: 'yeogirok-cloud-anchor',
  recordId: 'record-1',
  anchorType: 'CLOUD',
  anchorId: 'cloud-id-1',
  ttlDays: 1,
  hostedAt: '2026-10-29T10:00:00Z',
  expiresAtEstimate: '2026-10-30T10:00:00Z',
  hostSessionId: 'host-session',
  hostDeviceLabel: 'device A',
  featureMapQuality: 'GOOD',
  hitType: 'PLANE',
  depthEnabled: true,
  depthHitAllowed: false,
  geospatial: null,
  crossDeviceVerified: false,
  localPose: {
    frame: 'native-arcore-session',
    positionMeters: [1, 2, 3],
    rotationQuaternionXYZW: [0, 0, 0, 1],
  },
  operation: {
    type: 'HOST',
    sessionId: 'host-session',
    deviceLabel: 'device A',
    recordedAt: '2026-10-29T10:00:05Z',
    durationMs: 5000,
  },
});
test('Cloud record carries no camera GPS and preserves host identity', () => {
  const record = parseCloudRecord(JSON.stringify(fixture()));
  expect(record.geospatial).toBeNull();
  expect(record.hostSessionId).toBe('host-session');
  expect(record.qualityPolicy).toBe('GOOD_STABLE');
});
test.each(['INSUFFICIENT', 'SUFFICIENT', 'GOOD'])(
  'explicit experiment retains the actual host quality %s',
  quality => {
    const parsed = parseCloudRecord(
      JSON.stringify({
        ...fixture(),
        featureMapQuality: quality,
        qualityPolicy: 'DIAGNOSTIC_CURRENT_QUALITY',
      }),
    );
    expect(parsed.featureMapQuality).toBe(quality);
    expect(parsed.crossDeviceVerified).toBe(false);
  },
);
test.each([
  { featureMapQuality: 'INSUFFICIENT', qualityPolicy: 'GOOD_STABLE' },
  { featureMapQuality: 'UNKNOWN', qualityPolicy: 'DIAGNOSTIC_CURRENT_QUALITY' },
  { qualityPolicy: null },
  { qualityPolicy: 'anything' },
])('rejects misleading experiment quality metadata %j', change => {
  expect(() =>
    parseCloudRecord(JSON.stringify({ ...fixture(), ...change })),
  ).toThrow();
});
test('expired records remain readable but cannot be resolved', () => {
  const raw = JSON.stringify(fixture());
  expect(() => parseCloudRecord(raw)).not.toThrow();
  expect(() =>
    parseCloudRecord(raw, true, Date.parse('2026-10-30T09:59:59Z')),
  ).not.toThrow();
  expect(() =>
    parseCloudRecord(raw, true, Date.parse('2026-10-30T10:00:00Z')),
  ).toThrow('수명');
});
test('import cannot certify cross-device accuracy', () => {
  expect(
    parseCloudRecord(
      JSON.stringify({ ...fixture(), crossDeviceVerified: true }),
    ).crossDeviceVerified,
  ).toBe(false);
});
test.each([
  { geospatial: { latitude: 37, longitude: 127 } },
  { anchorId: '' },
  { anchorId: 'id\nwith-line' },
  { kind: 'geospatial' },
  { ttlDays: 365 },
  { featureMapQuality: 'INSUFFICIENT' },
  { hitType: 'FEATURE_POINT' },
  { expiresAtEstimate: '2027-10-29T10:00:00Z' },
  {
    localPose: { ...fixture().localPose, rotationQuaternionXYZW: [0, 0, 0, 0] },
  },
  { localPose: { ...fixture().localPose, positionMeters: [null, 0, 0] } },
  { operation: { ...fixture().operation, durationMs: -1 } },
])('rejects malformed/unsupported Cloud records: %j', change => {
  expect(() =>
    parseCloudRecord(JSON.stringify({ ...fixture(), ...change })),
  ).toThrow();
});
test('resolve observation preserves source pose without claiming ground truth', () => {
  const record = {
    ...fixture(),
    operation: {
      ...fixture().operation,
      type: 'RESOLVE',
      sessionId: 'new-session',
      deviceLabel: 'device B',
    },
    restorationEstimate: {
      horizontalOffsetMeters: 0.4,
      verticalOffsetMeters: -0.1,
      referenceHitType: 'DEPTH',
      groundTruth: false,
    },
  };
  const parsed = parseCloudRecord(JSON.stringify(record));
  expect(parsed.hostDeviceLabel).toBe('device A');
  expect(parsed.operation.deviceLabel).toBe('device B');
  expect(parsed.restorationEstimate?.verticalOffsetMeters).toBe(-0.1);
  expect(() =>
    parseCloudRecord(
      JSON.stringify({
        ...record,
        restorationEstimate: {
          ...record.restorationEstimate,
          groundTruth: true,
        },
      }),
    ),
  ).toThrow();
});

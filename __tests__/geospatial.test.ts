import {
  compareReference,
  horizontalDistanceMeters,
  parseGeoRecord,
} from '../geospatial';

const fixture = () => ({
  schemaVersion: 2,
  kind: 'yeogirok-geospatial-placement',
  recordId: 'test-id',
  sessionId: 'test-session',
  confirmedAt: '2026-10-28T00:00:00Z',
  tip: {
    latitude: 37,
    longitude: 127,
    altitude: 30,
    altitudeReference: 'WGS84_ELLIPSOID',
    eusQuaternion: [0, 0, 0, 1],
  },
  accuracy: {
    horizontalMeters: 2,
    verticalMeters: 3,
    yawDegrees: 4,
    confidence: 0.68,
    source: 'ARCore-GeospatialPose',
    measuredError: 99,
  },
  crossDeviceVerified: true,
});
const parse = (value: unknown) => parseGeoRecord(JSON.stringify(value));

test('accepts geospatial data and never treats imported flags as verification', () => {
  const record = parse(fixture());
  expect(record.tip.latitude).toBe(37);
  expect(record.crossDeviceVerified).toBe(false);
  expect(record.accuracy.measuredError).toBeNull();
});
test('rejects local-only poses, invalid geospatial coordinates and quaternions', () => {
  expect(() => parse({ kind: 'yeogirok-local-placement' })).toThrow();
  for (const change of [
    { latitude: 91 },
    { longitude: 181 },
    { altitude: null },
    { eusQuaternion: [0, 0, 0, 0] },
  ]) {
    const record = fixture();
    expect(() =>
      parse({ ...record, tip: { ...record.tip, ...change } }),
    ).toThrow();
  }
});
test('distance is symmetric, handles the dateline, and is zero at the same point', () => {
  const a = { latitude: 0, longitude: 179.999 };
  const b = { latitude: 0, longitude: -179.999 };
  expect(horizontalDistanceMeters(a, a)).toBe(0);
  expect(horizontalDistanceMeters(a, b)).toBeCloseTo(222.39, 2);
  expect(horizontalDistanceMeters(a, b)).toBeCloseTo(
    horizontalDistanceMeters(b, a),
    8,
  );
});
test('reference comparison preserves uncertainty and does not certify AR restoration', () => {
  const record = parse({
    ...fixture(),
    reference: {
      latitude: 37,
      longitude: 127,
      source: 'surveyed',
      sourceLabel: 'synthetic',
      uncertaintyMeters: 0.1,
      capturedAt: '2026-10-28T00:00:00Z',
    },
  });
  expect(compareReference(record)).toMatchObject({
    horizontalSeparationMeters: 0,
    referenceUncertaintyMeters: 0.1,
    arRestorationVerified: false,
  });
  expect(compareReference(parse(fixture()))).toBeNull();
});
test('restoration measurements require provenance and a restoration parent', () => {
  const observation = {
    horizontalOffsetMeters: 0.3,
    verticalOffsetMeters: -0.1,
    method: 'tape',
    deviceLabel: 'test-device',
    observedAt: '2026-10-28T00:00:00Z',
  };
  expect(() =>
    parse({ ...fixture(), restorationObservation: observation }),
  ).toThrow();
  const valid = {
    ...fixture(),
    restoredFrom: 'original',
    restorationObservation: observation,
  };
  expect(parse(valid).restorationObservation?.horizontalOffsetMeters).toBe(0.3);
  expect(() =>
    parse({
      ...valid,
      restorationObservation: { ...observation, horizontalOffsetMeters: -1 },
    }),
  ).toThrow();
});
test('rejects invalid accuracy and incomplete reference data', () => {
  const record = fixture();
  expect(() =>
    parse({
      ...record,
      accuracy: { ...record.accuracy, horizontalMeters: -1 },
    }),
  ).toThrow();
  expect(() =>
    parse({ ...record, reference: { latitude: 37, longitude: 127 } }),
  ).toThrow();
  expect(() => parseGeoRecord(' '.repeat(65537))).toThrow();
});

test('AR touch estimates stay separate from manual observations and verified error', () => {
  const estimate = {
    horizontalOffsetMeters: 0.3,
    verticalOffsetMeters: -0.1,
    method: 'arcore-plane-hit-test',
    deviceLabel: 'test-device',
    estimatedAt: '2026-10-29T00:00:00Z',
    groundTruth: false,
  };
  const record = parse({
    ...fixture(),
    restoredFrom: 'original',
    restorationEstimate: estimate,
  });
  expect(record.restorationEstimate).toEqual(estimate);
  expect(record.restorationObservation).toBeUndefined();
  expect(record.accuracy.measuredError).toBeNull();
  expect(record.crossDeviceVerified).toBe(false);
  expect(() =>
    parse({ ...fixture(), restorationEstimate: estimate }),
  ).toThrow();
  for (const change of [
    { groundTruth: true },
    { horizontalOffsetMeters: -1 },
    { verticalOffsetMeters: null },
    { method: 'tape' },
    { deviceLabel: '' },
    { estimatedAt: 'invalid' },
  ]) {
    expect(() =>
      parse({
        ...fixture(),
        restoredFrom: 'original',
        restorationEstimate: { ...estimate, ...change },
      }),
    ).toThrow();
  }
});

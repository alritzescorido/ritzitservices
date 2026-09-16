import 'package:flutter_test/flutter_test.dart';
import 'package:presyo/api/client.dart';
import 'package:presyo/api/models.dart';
import 'package:presyo/screens/shell.dart';
import 'package:presyo/ui.dart';

void main() {
  test('money formats the API decimal strings', () {
    expect(money('165240.00'), '₱165,240.00');
    expect(money(null), '—');
    expect(money('abc'), 'abc');
  });

  test('unit labels', () {
    expect(unitLabel('per_kg_liveweight'), '/kg');
    expect(unitLabel('per_head'), '/ulo');
  });

  test('user needs a profile until named and given a role', () {
    final blank = User.fromJson({'id': 'u1', 'phone_masked': '+63917*****01', 'full_name': '', 'roles': <String>[], 'verification': 'pending'});
    expect(blank.needsProfile, isTrue);
    final farmer = User.fromJson({'id': 'u1', 'phone_masked': '+63917*****01', 'full_name': 'Maria Santos', 'roles': ['farmer'], 'verification': 'verified'});
    expect(farmer.needsProfile, isFalse);
    expect(farmer.verified, isTrue);
  });

  test('a bare child row is named and placed under its parent', () {
    final town = Location.fromJson({
      'psgc_code': '1206319000',
      'parent_code': '1206300000',
      'level': 'municipality',
      'name': 'Lake Sebu',
      'display_name': 'Lake Sebu, South Cotabato',
      'path': [
        {'psgc_code': '1200000000', 'level': 'region', 'name': 'SOCCSKSARGEN'},
        {'psgc_code': '1206300000', 'level': 'province', 'name': 'South Cotabato'},
      ],
    });
    // Exactly what GET /locations?parent= sends: no display_name, no path.
    final bare = Location.fromJson({'psgc_code': '1206319014', 'parent_code': '1206319000', 'level': 'barangay', 'name': 'Poblacion'});
    final placed = bare.under(town);
    expect(placed.displayName, 'Poblacion, Lake Sebu, South Cotabato');
    expect(placed.municipality?.name, 'Lake Sebu');
    expect(placed.code, '1206319014');
  });

  test('idempotency keys are random v4 uuids, not clock-derived', () {
    final ids = List.generate(500, (_) => ApiClient.uuid());
    expect(ids.toSet().length, 500, reason: 'two writes in one microsecond must not share a key');
    for (final id in ids) {
      expect(id, matches(RegExp(r'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')));
    }
  });

  test('board row parses provenance', () {
    final r = BoardRow.fromJson({
      'species': 'hog',
      'weight_class': {'id': 3, 'label': '80-100 kg', 'unit': 'per_kg_liveweight'},
      'unit': 'per_kg_liveweight',
      'source': 'municipality',
      'location_name': 'Talavera',
      'median_price': '180.00',
      'low_price': '176.00',
      'high_price': '182.00',
      'sample_count': 7,
      'change_30d_pct': 2.5,
      'sparkline': ['178', null, '180.0'],
    });
    expect(r.sampleCount, 7);
    expect(r.change30d, 2.5);
    expect(r.sparkline, [178.0, null, 180.0]);
  });

  test('tabs follow the roles a person actually has', () {
    expect(tabKeysFor(['farmer']), ['board', 'herd', 'sell', 'deals', 'me']);
    expect(tabKeysFor(['buyer']), ['board', 'market', 'deals', 'me']);
    expect(tabKeysFor(['hauler']), ['board', 'jobs', 'trips', 'me']);
    // Two roles merge, and the tabs they share appear once.
    expect(tabKeysFor(['buyer', 'farmer']), ['board', 'herd', 'sell', 'deals', 'market', 'me']);
    // An admin with no trade role still gets somewhere to land.
    expect(tabKeysFor(['admin']), ['board', 'me']);
  });

  test('roles are ordered for the tab bar whatever order the API sends', () {
    final u = User.fromJson({'id': 'u1', 'phone_masked': '·1234', 'full_name': 'Ana', 'roles': ['hauler', 'farmer'], 'verification': 'verified'});
    expect(u.tradeRoles, ['farmer', 'hauler']);
    expect(u.isHauler, isTrue);
    expect(u.isBuyer, isFalse);
  });

  test('a shipment knows when it is on the road', () {
    Shipment at(String status) => Shipment.fromJson({
          'id': 's1',
          'deal_id': 'd1',
          'status': status,
          'deal_state': 'in_transit',
          'species': 'hog',
          'heads': 12,
          'farm_name': 'Maligaya',
          'pickup': {'psgc_code': '1206319014', 'name': 'Poblacion', 'level': 'barangay'},
          'agreed_fee': '3500.00',
          'events': [],
        });
    expect(at('assigned').onTheRoad, isFalse);
    expect(at('in_transit').onTheRoad, isTrue);
    expect(at('delivered').onTheRoad, isFalse);
    expect(at('in_transit').heads, 12);
  });
}

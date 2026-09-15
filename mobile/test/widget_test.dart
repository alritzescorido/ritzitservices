import 'package:flutter_test/flutter_test.dart';
import 'package:presyo/api/models.dart';
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
}

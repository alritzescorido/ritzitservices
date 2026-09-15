// Hand-written models for the parts of docs/api/openapi.yaml the farmer app
// uses. Money and weights stay strings (the API's decimal strings); the UI
// formats them.

String? _s(dynamic v) => v?.toString();
int _i(dynamic v) => v is int ? v : int.tryParse(v?.toString() ?? '') ?? 0;
double? _d(dynamic v) => v == null ? null : (v is num ? v.toDouble() : double.tryParse(v.toString()));

const speciesLabel = {'hog': 'Baboy', 'cattle': 'Baka', 'carabao': 'Kalabaw', 'goat': 'Kambing', 'native_chicken': 'Native na manok'};
const speciesAll = ['hog', 'cattle', 'carabao', 'goat', 'native_chicken'];

class User {
  User.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        phoneMasked = j['phone_masked'] as String,
        fullName = (j['full_name'] as String?) ?? '',
        preferredLang = (j['preferred_lang'] as String?) ?? 'fil',
        roles = ((j['roles'] as List?) ?? const []).cast<String>(),
        verification = j['verification'] as String,
        verificationNotes = _s(j['verification_notes']);
  final String id, phoneMasked, fullName, preferredLang, verification;
  final List<String> roles;
  final String? verificationNotes;
  bool get isFarmer => roles.contains('farmer');
  bool get verified => verification == 'verified';
  bool get needsProfile => fullName.isEmpty || roles.where((r) => r != 'admin').isEmpty;
}

class Location {
  Location.fromJson(Map<String, dynamic> j)
      : code = j['psgc_code'] as String,
        name = j['name'] as String,
        level = j['level'] as String,
        displayName = (j['display_name'] as String?) ?? (j['name'] as String),
        path = ((j['path'] as List?) ?? const []).map((p) => Location.fromJson(p as Map<String, dynamic>)).toList();
  final String code, name, level, displayName;
  final List<Location> path;
  Location? get municipality => level == 'municipality' ? this : path.cast<Location?>().firstWhere((p) => p!.level == 'municipality', orElse: () => null);

  /// Names and places a bare child row the way search would have. Rows from
  /// `GET /locations?parent=` carry no display_name or path of their own.
  Location under(Location parent) => Location.fromJson({
        ...toJson(),
        'display_name': '$name, ${parent.displayName}',
        'path': [
          for (final p in parent.path) {'psgc_code': p.code, 'name': p.name, 'level': p.level},
          {'psgc_code': parent.code, 'name': parent.name, 'level': parent.level},
        ],
      });
  Map<String, dynamic> toJson() => {'psgc_code': code, 'name': name, 'level': level, 'display_name': displayName, 'path': path.map((p) => {'psgc_code': p.code, 'name': p.name, 'level': p.level}).toList()};
}

class WeightClass {
  WeightClass.fromJson(Map<String, dynamic> j)
      : id = _i(j['id']),
        label = j['label'] as String,
        unit = j['unit'] as String;
  final int id;
  final String label, unit;
}

class BoardRow {
  BoardRow.fromJson(Map<String, dynamic> j)
      : species = j['species'] as String,
        weightClass = WeightClass.fromJson(j['weight_class'] as Map<String, dynamic>),
        unit = j['unit'] as String,
        source = j['source'] as String,
        locationName = j['location_name'] as String,
        median = _s(j['median_price']),
        low = _s(j['low_price']),
        high = _s(j['high_price']),
        sampleCount = _i(j['sample_count']),
        change30d = _d(j['change_30d_pct']),
        referenceSource = _s(j['reference_source']),
        sparkline = ((j['sparkline'] as List?) ?? const []).map(_d).toList();
  final String species, unit, source, locationName;
  final WeightClass weightClass;
  final String? median, low, high, referenceSource;
  final int sampleCount;
  final double? change30d;
  final List<double?> sparkline;
}

class Board {
  Board.fromJson(Map<String, dynamic> j)
      : municipality = Location.fromJson(j['municipality'] as Map<String, dynamic>),
        province = j['province'] == null ? null : Location.fromJson(j['province'] as Map<String, dynamic>),
        asOf = j['as_of'] as String,
        items = (j['items'] as List).map((r) => BoardRow.fromJson(r as Map<String, dynamic>)).toList();
  final Location municipality;
  final Location? province;
  final String asOf;
  final List<BoardRow> items;
}

class Farm {
  Farm.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        name = j['name'] as String,
        farmType = _s(j['farm_type']),
        location = Location.fromJson(j['location'] as Map<String, dynamic>);
  final String id, name;
  final String? farmType;
  final Location location;
}

class Lot {
  Lot.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        farmId = j['farm_id'] as String,
        species = j['species'] as String,
        headCount = _i(j['head_count']),
        avgWeightKg = _s(j['avg_weight_kg']),
        breed = _s(j['breed']),
        weightClass = WeightClass.fromJson(j['weight_class'] as Map<String, dynamic>),
        photoKeys = ((j['photo_keys'] as List?) ?? const []).cast<String>();
  final String id, farmId, species;
  final int headCount;
  final String? avgWeightKg, breed;
  final WeightClass weightClass;
  final List<String> photoKeys;
}

class Listing {
  Listing.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        status = j['status'] as String,
        species = j['species'] as String,
        weightClass = WeightClass.fromJson(j['weight_class'] as Map<String, dynamic>),
        unit = j['unit'] as String,
        headsOffered = _i(j['heads_offered']),
        askingPrice = j['asking_price'].toString(),
        boardPrice = _s(j['board_price']),
        vsBoardPct = _d(j['vs_board_pct']),
        estimatedTotal = _s(j['estimated_total']),
        pendingOffers = _i(j['pending_offers']),
        createdAt = j['created_at'] as String;
  final String id, status, species, unit, askingPrice, createdAt;
  final WeightClass weightClass;
  final int headsOffered, pendingOffers;
  final String? boardPrice, estimatedTotal;
  final double? vsBoardPct;
}

class Offer {
  Offer.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        buyerName = (j['buyer_name'] as String?) ?? 'Buyer',
        offeredBy = j['offered_by'] as String,
        status = j['status'] as String,
        price = j['price'].toString(),
        heads = _i(j['heads']),
        pickupOn = _s(j['pickup_on']),
        needsHauler = j['needs_hauler'] == true,
        note = _s(j['note']),
        estimatedTotal = _s(j['estimated_total']),
        expiresAt = j['expires_at'] as String;
  final String id, buyerName, offeredBy, status, price, expiresAt;
  final int heads;
  final bool needsHauler;
  final String? pickupOn, note, estimatedTotal;
}

class Deposit {
  Deposit.fromJson(Map<String, dynamic> j)
      : status = j['status'] as String,
        amount = j['amount'].toString(),
        booking = (j['booking'] ?? j['amount']).toString(),
        commission = (j['commission'] ?? '0').toString(),
        expiresAt = j['expires_at'] as String,
        paidAt = _s(j['paid_at']),
        checkoutUrl = _s(j['checkout_url']);
  /// amount is what the buyer pays; booking is all the farmer is ever promised.
  final String status, amount, booking, commission, expiresAt;
  bool get hasCommission => (double.tryParse(commission) ?? 0) > 0;
  final String? paidAt, checkoutUrl;
}

class DealEvent {
  DealEvent.fromJson(Map<String, dynamic> j)
      : toState = j['to_state'] as String,
        note = _s(j['note']),
        createdAt = j['created_at'] as String;
  final String toState, createdAt;
  final String? note;
}

class Deal {
  Deal.fromJson(Map<String, dynamic> j)
      : id = j['id'] as String,
        farmerId = j['farmer_id'] as String,
        buyerId = j['buyer_id'] as String,
        farmerName = (j['farmer_name'] as String?) ?? '',
        buyerName = (j['buyer_name'] as String?) ?? '',
        species = j['species'] as String,
        weightClassLabel = _s((j['weight_class'] as Map?)?['label']),
        unit = j['unit'] as String,
        state = j['state'] as String,
        agreedPrice = j['agreed_price'].toString(),
        agreedHeads = _i(j['agreed_heads']),
        agreedWeightKg = _s(j['agreed_weight_kg']),
        estimatedTotal = _s(j['estimated_total']),
        deliveredHeads = j['delivered_heads'] == null ? null : _i(j['delivered_heads']),
        deliveredWeightKg = _s(j['delivered_weight_kg']),
        finalTotal = _s(j['final_total']),
        needsHauler = j['needs_hauler'] == true,
        paymentMethod = _s(j['payment_method']),
        paymentReference = _s(j['payment_reference']),
        buyerPaidAt = _s(j['buyer_paid_at']),
        farmerConfirmedAt = _s(j['farmer_confirmed_at']),
        cancelReason = _s(j['cancel_reason']),
        locationName = (j['location'] as Map<String, dynamic>)['display_name'] as String,
        haulerLine = _hauler(j['shipment'] as Map<String, dynamic>?),
        depositRequired = j['deposit_required'] == true,
        deposit = j['deposit'] == null ? null : Deposit.fromJson(j['deposit'] as Map<String, dynamic>),
        events = ((j['events'] as List?) ?? const []).map((e) => DealEvent.fromJson(e as Map<String, dynamic>)).toList(),
        acceptedAt = j['accepted_at'] as String;
  final String id, farmerId, buyerId, farmerName, buyerName, species, unit, state, agreedPrice, locationName, acceptedAt;
  final String? weightClassLabel, agreedWeightKg, estimatedTotal, deliveredWeightKg, finalTotal, paymentMethod, paymentReference, buyerPaidAt, farmerConfirmedAt, cancelReason, haulerLine;
  final int agreedHeads;
  final int? deliveredHeads;
  final bool needsHauler, depositRequired;
  final Deposit? deposit;
  final List<DealEvent> events;

  static String? _hauler(Map<String, dynamic>? s) {
    if (s == null) return null;
    final plate = s['vehicle_plate'] == null ? '' : ' (${s['vehicle_plate']})';
    return '${s['hauler_name']}$plate · ${(s['status'] as String).replaceAll('_', ' ')}';
  }
}

class UserDocument {
  UserDocument.fromJson(Map<String, dynamic> j)
      : docType = j['doc_type'] as String,
        status = j['status'] as String,
        notes = _s(j['notes']),
        uploadedAt = j['uploaded_at'] as String;
  final String docType, status, uploadedAt;
  final String? notes;
}

class PayoutAccount {
  PayoutAccount.fromJson(Map<String, dynamic> j)
      : kind = j['kind'] as String,
        masked = j['account_no_masked'] as String,
        verified = j['verified'] == true;
  final String kind, masked;
  final bool verified;
}

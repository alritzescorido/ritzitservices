import 'client.dart';
import 'models.dart';

/// One function per contract operation, named after its operationId.
class Api {
  static ApiClient get c => ApiClient.instance;
  static Map<String, dynamic> _m(dynamic v) => v as Map<String, dynamic>;
  static List<Map<String, dynamic>> _items(dynamic v) => (_m(v)['items'] as List).cast<Map<String, dynamic>>();

  // Auth and me
  static Future<Map<String, dynamic>> otpRequest(String phone) async => _m(await c.call('POST', '/auth/otp/request', body: {'phone': phone}, auth: false));
  static Future<User> otpVerify(String challengeId, String code, String deviceId) async {
    final j = _m(await c.call('POST', '/auth/otp/verify', body: {'challenge_id': challengeId, 'code': code, 'device': {'device_id': deviceId, 'platform': 'android', 'app_version': 'flutter-0.1'}}, auth: false));
    await c.saveTokens(j['access_token'] as String, j['refresh_token'] as String);
    return User.fromJson(_m(j['user']));
  }
  static Future<User> me() async => User.fromJson(_m(await c.call('GET', '/me')));
  static Future<User> updateMe({String? fullName, String? lang}) async => User.fromJson(_m(await c.call('PATCH', '/me', body: {'full_name': ?fullName, 'preferred_lang': ?lang})));
  static Future<User> addRole(String role) async => User.fromJson(_m(await c.call('POST', '/me/roles', body: {'role': role})));
  static Future<void> logout() async {
    final rt = c.refreshTokenValue;
    if (rt != null) {
      try {
        await c.call('POST', '/auth/logout', body: {'refresh_token': rt});
      } catch (_) {}
    }
    await c.clearTokens();
  }
  static Future<List<UserDocument>> documents() async => _items(await c.call('GET', '/me/documents')).map(UserDocument.fromJson).toList();
  static Future<void> registerDocument(String docType, String key) => c.call('POST', '/me/documents', body: {'doc_type': docType, 'storage_key': key}, idempotent: true);

  /// What the app may know before anyone signs in, such as whether an ID is required.
  static Future<bool> requireDocuments() async {
    try {
      return _m(await c.call('GET', '/settings', auth: false))['require_documents'] != false;
    } catch (_) {
      return true; // assume required if the server cannot say
    }
  }

  // Locations and prices
  static Future<List<Location>> searchLocations(String q, {String? level}) async => _items(await c.call('GET', '/locations/search', query: {'q': q, 'level': level ?? '', 'limit': '8'}, auth: false)).map(Location.fromJson).toList();
  /// Children of a place, e.g. the barangays of one municipality.
  static Future<List<Location>> children(String parent) async => _items(await c.call('GET', '/locations', query: {'parent': parent, 'limit': '100'}, auth: false)).map(Location.fromJson).toList();
  static Future<Board> board(String municipalityCode, {String? species}) async => Board.fromJson(_m(await c.call('GET', '/prices/board', query: {'municipality_code': municipalityCode, 'species': species ?? ''}, auth: false)));

  // Farms and lots
  static Future<List<Farm>> farms() async => _items(await c.call('GET', '/farms')).map(Farm.fromJson).toList();
  static Future<Farm> createFarm(String name, String barangayCode, String farmType) async => Farm.fromJson(_m(await c.call('POST', '/farms', body: {'name': name, 'barangay_code': barangayCode, 'farm_type': farmType}, idempotent: true)));
  static Future<List<Lot>> lots(String farmId) async => _items(await c.call('GET', '/farms/$farmId/lots')).map(Lot.fromJson).toList();
  static Future<Lot> createLot(String farmId, Map<String, dynamic> input) async => Lot.fromJson(_m(await c.call('POST', '/farms/$farmId/lots', body: input, idempotent: true)));

  // Marketplace, farmer side
  static Future<List<Listing>> myListings() async => _items(await c.call('GET', '/listings', query: {'mine': 'true', 'limit': '50'})).map(Listing.fromJson).toList();
  static Future<Listing> createListing(String lotId, int heads, String price) async => Listing.fromJson(_m(await c.call('POST', '/listings', body: {'lot_id': lotId, 'heads_offered': heads, 'asking_price': price}, idempotent: true)));
  static Future<List<Offer>> offers(String listingId) async => _items(await c.call('GET', '/listings/$listingId/offers')).map(Offer.fromJson).toList();
  static Future<Deal> acceptOffer(String offerId) async => Deal.fromJson(_m(await c.call('POST', '/offers/$offerId/accept', idempotent: true)));
  static Future<void> counterOffer(String offerId, String price, int heads) => c.call('POST', '/offers/$offerId/counter', body: {'price': price, 'heads': heads}, idempotent: true);
  static Future<void> rejectOffer(String offerId) => c.call('POST', '/offers/$offerId/reject', body: {'note': null}, idempotent: true);

  // Deals
  static Future<List<Deal>> deals() async => _items(await c.call('GET', '/deals', query: {'limit': '50'})).map(Deal.fromJson).toList();
  static Future<Deal> deal(String id) async => Deal.fromJson(_m(await c.call('GET', '/deals/$id')));
  static Future<Deal> confirmPayment(String id) async => Deal.fromJson(_m(await c.call('POST', '/deals/$id/confirm-payment', idempotent: true)));
  static Future<Deal> cancelDeal(String id, String reason) async => Deal.fromJson(_m(await c.call('POST', '/deals/$id/cancel', body: {'reason': reason}, idempotent: true)));
  static Future<void> dispute(String id, String reason, String details) => c.call('POST', '/deals/$id/dispute', body: {'reason': reason, 'details': details}, idempotent: true);
  static Future<void> rate(String id, int score) => c.call('POST', '/deals/$id/ratings', body: {'score': score, 'comment': null});

  // Marketplace, buyer side
  static Future<List<Listing>> browse({String? species, String? provinceCode}) async =>
      _items(await c.call('GET', '/listings', query: {'species': species ?? '', 'province_code': provinceCode ?? '', 'limit': '50'})).map(Listing.fromJson).toList();
  static Future<Offer> makeOffer(String listingId, Map<String, dynamic> input) async => Offer.fromJson(_m(await c.call('POST', '/listings/$listingId/offers', body: input, idempotent: true)));
  static Future<Deal> deliverDeal(String id, Map<String, dynamic> input) async => Deal.fromJson(_m(await c.call('POST', '/deals/$id/deliver', body: input, idempotent: true)));
  static Future<Deal> payDeal(String id, String method, String? reference) async =>
      Deal.fromJson(_m(await c.call('POST', '/deals/$id/pay', body: {'method': method, 'reference': reference}, idempotent: true)));
  static Future<Deposit> deposit(String dealId) async => Deposit.fromJson(_m(await c.call('GET', '/deals/$dealId/deposit')));
  static Future<Deposit> refreshCheckout(String dealId) async => Deposit.fromJson(_m(await c.call('POST', '/deals/$dealId/deposit/checkout', idempotent: true)));

  // Logistics, hauler side
  static Future<HaulerProfile?> haulerProfile() async {
    try {
      return HaulerProfile.fromJson(_m(await c.call('GET', '/haulers/me')));
    } on ApiException catch (e) {
      if (e.status == 404) return null;
      rethrow;
    }
  }
  static Future<HaulerProfile> putHaulerProfile(Map<String, dynamic> input) async => HaulerProfile.fromJson(_m(await c.call('PUT', '/haulers/me', body: input)));
  static Future<List<HaulJob>> haulJobs({bool fitsMyTruck = false}) async =>
      _items(await c.call('GET', '/haul-jobs', query: {'fits_my_truck': fitsMyTruck ? 'true' : ''})).map(HaulJob.fromJson).toList();
  static Future<Shipment> acceptHaulJob(String dealId, String fee, String scheduledPickupAt) async =>
      Shipment.fromJson(_m(await c.call('POST', '/haul-jobs/$dealId/accept', body: {'agreed_fee': fee, 'scheduled_pickup_at': scheduledPickupAt}, idempotent: true)));
  static Future<List<Shipment>> shipments() async => _items(await c.call('GET', '/shipments')).map(Shipment.fromJson).toList();
  static Future<Shipment> shipment(String id) async => Shipment.fromJson(_m(await c.call('GET', '/shipments/$id')));
  static Future<Shipment> startTrip(String id, Map<String, dynamic> input) async => Shipment.fromJson(_m(await c.call('POST', '/shipments/$id/start', body: input, idempotent: true)));
  static Future<void> ping(String id, double lat, double lng, {String kind = 'position', String? note}) =>
      c.call('POST', '/shipments/$id/ping', body: {'geo': {'lat': lat, 'lng': lng}, 'kind': kind, 'note': note});
  static Future<Shipment> markDelivered(String id, Map<String, dynamic> input) async => Shipment.fromJson(_m(await c.call('POST', '/shipments/$id/delivered', body: input, idempotent: true)));
  static Future<Shipment> cancelShipment(String id, String reason) async => Shipment.fromJson(_m(await c.call('POST', '/shipments/$id/cancel', body: {'reason': reason}, idempotent: true)));

  // Payments
  static Future<PayoutAccount?> payoutAccount() async {
    try {
      return PayoutAccount.fromJson(_m(await c.call('GET', '/me/payout-account')));
    } on ApiException catch (e) {
      if (e.status == 404) return null;
      rethrow;
    }
  }
  static Future<PayoutAccount> putPayoutAccount(String kind, String accountNo, String accountName, String? bankCode) async =>
      PayoutAccount.fromJson(_m(await c.call('PUT', '/me/payout-account', body: {'kind': kind, 'account_no': accountNo, 'account_name': accountName, 'bank_code': bankCode})));
}

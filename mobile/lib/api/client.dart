import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:http/http.dart' as http;
import 'package:shared_preferences/shared_preferences.dart';

/// RFC 9457 problem details, as the API sends them.
class ApiException implements Exception {
  ApiException(this.status, this.body);
  final int status;
  final Map<String, dynamic> body;

  String get title => (body['title'] as String?) ?? 'Request failed';
  String get detail => (body['detail'] as String?) ?? title;
  List<Map<String, dynamic>> get errors => ((body['errors'] as List?) ?? const []).cast<Map<String, dynamic>>();

  /// One readable line for a snackbar or form note.
  String get message {
    if (errors.isEmpty) return detail;
    return errors.map((e) => '${e['field']}: ${e['message']}').join('\n');
  }

  @override
  String toString() => 'ApiException($status): $message';
}

/// One HTTP client for the app. Base URL is configurable on the sign-in
/// screen (a phone cannot reach localhost); tokens live in secure storage;
/// a 401 refreshes once; every write carries an Idempotency-Key.
class ApiClient {
  ApiClient._();
  static final ApiClient instance = ApiClient._();

  static const _defaultBase = 'http://192.168.1.196:3000/v1';
  final _storage = const FlutterSecureStorage();
  final _http = http.Client();

  String baseUrl = _defaultBase;
  String? _access;
  String? _refresh;
  void Function()? onSessionLost;

  Future<void> init() async {
    final prefs = await SharedPreferences.getInstance();
    baseUrl = prefs.getString('api_base') ?? _defaultBase;
    _access = await _storage.read(key: 'access');
    _refresh = await _storage.read(key: 'refresh');
  }

  bool get signedIn => _refresh != null;

  Future<void> setBaseUrl(String url) async {
    baseUrl = url.replaceAll(RegExp(r'/+$'), '');
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString('api_base', baseUrl);
  }

  Future<void> saveTokens(String access, String refresh) async {
    _access = access;
    _refresh = refresh;
    await _storage.write(key: 'access', value: access);
    await _storage.write(key: 'refresh', value: refresh);
  }

  Future<void> clearTokens() async {
    _access = null;
    _refresh = null;
    await _storage.delete(key: 'access');
    await _storage.delete(key: 'refresh');
  }

  String? get refreshTokenValue => _refresh;

  Future<bool> refresh() async {
    final rt = _refresh;
    if (rt == null) return false;
    final res = await _http.post(Uri.parse('$baseUrl/auth/refresh'), headers: {'Content-Type': 'application/json'}, body: jsonEncode({'refresh_token': rt}));
    if (res.statusCode != 200) {
      await clearTokens();
      onSessionLost?.call();
      return false;
    }
    final j = jsonDecode(res.body) as Map<String, dynamic>;
    await saveTokens(j['access_token'] as String, j['refresh_token'] as String);
    return true;
  }

  /// JSON in, JSON out. `auth: false` for the public endpoints.
  Future<dynamic> call(String method, String path, {Object? body, bool auth = true, bool idempotent = false, Map<String, String>? query}) async {
    Future<http.Response> send() {
      final uri = Uri.parse('$baseUrl$path').replace(queryParameters: query == null ? null : {for (final e in query.entries) if (e.value.isNotEmpty) e.key: e.value});
      final headers = <String, String>{'Accept': 'application/json'};
      if (auth && _access != null) headers['Authorization'] = 'Bearer $_access';
      if (body != null) headers['Content-Type'] = 'application/json';
      if (idempotent) headers['Idempotency-Key'] = _uuid();
      final encoded = body == null ? null : jsonEncode(body);
      switch (method) {
        case 'GET':
          return _http.get(uri, headers: headers);
        case 'POST':
          return _http.post(uri, headers: headers, body: encoded);
        case 'PUT':
          return _http.put(uri, headers: headers, body: encoded);
        case 'PATCH':
          return _http.patch(uri, headers: headers, body: encoded);
        default:
          throw ArgumentError(method);
      }
    }

    var res = await send();
    if (res.statusCode == 401 && auth && _refresh != null) {
      if (await refresh()) res = await send();
    }
    if (res.statusCode == 204) return null;
    final text = utf8.decode(res.bodyBytes);
    final parsed = text.isEmpty ? null : jsonDecode(text);
    if (res.statusCode >= 400) {
      throw ApiException(res.statusCode, parsed is Map<String, dynamic> ? parsed : {'title': res.reasonPhrase ?? 'Request failed', 'status': res.statusCode});
    }
    return parsed;
  }

  /// Signed upload: ask for a slot, PUT the bytes, return the storage key.
  Future<String> upload(String purpose, List<int> bytes, String contentType) async {
    final slot = await call('POST', '/uploads', body: {'purpose': purpose, 'content_type': contentType, 'byte_size': bytes.length}) as Map<String, dynamic>;
    final headers = (slot['headers'] as Map).cast<String, String>();
    final res = await _http.put(Uri.parse(slot['upload_url'] as String), headers: headers, body: bytes);
    if (res.statusCode >= 400) throw ApiException(res.statusCode, {'title': 'Upload failed', 'status': res.statusCode});
    return slot['storage_key'] as String;
  }

  static String _uuid() {
    final r = DateTime.now().microsecondsSinceEpoch;
    final rnd = List.generate(16, (i) => (r >> (i * 3) ^ (i * 2654435761)) & 0xff);
    rnd[6] = (rnd[6] & 0x0f) | 0x40;
    rnd[8] = (rnd[8] & 0x3f) | 0x80;
    final h = rnd.map((b) => b.toRadixString(16).padLeft(2, '0')).join();
    return '${h.substring(0, 8)}-${h.substring(8, 12)}-${h.substring(12, 16)}-${h.substring(16, 20)}-${h.substring(20)}';
  }
}

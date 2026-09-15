import 'dart:async';

import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../api/api.dart';
import '../api/client.dart';
import '../api/models.dart';
import '../ui.dart';

/// Wireframes Signin and OtpCode. Mobile number, then the 6-digit code.
class SignInScreen extends StatefulWidget {
  const SignInScreen({super.key, required this.onSignedIn});
  final void Function(User) onSignedIn;
  @override
  State<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends State<SignInScreen> {
  final _phone = TextEditingController();
  final _code = TextEditingController();
  final _server = TextEditingController(text: ApiClient.instance.baseUrl);
  String? _challenge;
  int _resendIn = 0;
  bool _busy = false;
  bool _showServer = false;
  Timer? _timer;

  @override
  void dispose() {
    _timer?.cancel();
    _phone.dispose();
    _code.dispose();
    _server.dispose();
    super.dispose();
  }

  String _normalise(String p) {
    final d = p.replaceAll(RegExp(r'[^\d+]'), '');
    if (d.startsWith('09') && d.length == 11) return '+63${d.substring(1)}';
    if (d.startsWith('9') && d.length == 10) return '+63$d';
    if (d.startsWith('63') && d.length == 12) return '+$d';
    return d;
  }

  Future<void> _send() async {
    setState(() => _busy = true);
    try {
      if (_server.text.trim() != ApiClient.instance.baseUrl) await ApiClient.instance.setBaseUrl(_server.text.trim());
      final r = await Api.otpRequest(_normalise(_phone.text));
      setState(() {
        _challenge = r['challenge_id'] as String;
        _resendIn = (r['resend_after_seconds'] as num?)?.toInt() ?? 60;
        _code.clear();
      });
      _timer?.cancel();
      _timer = Timer.periodic(const Duration(seconds: 1), (t) {
        if (!mounted) return t.cancel();
        setState(() => _resendIn = _resendIn > 0 ? _resendIn - 1 : 0);
        if (_resendIn == 0) t.cancel();
      });
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _verify() async {
    final ch = _challenge;
    if (ch == null) return;
    setState(() => _busy = true);
    try {
      final prefs = await SharedPreferences.getInstance();
      var device = prefs.getString('device_id');
      if (device == null) {
        device = 'and-${DateTime.now().microsecondsSinceEpoch}';
        await prefs.setString('device_id', device);
      }
      final u = await Api.otpVerify(ch, _code.text, device);
      widget.onSignedIn(u);
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 40, 20, 20),
          children: [
            Row(children: [
              Container(width: 40, height: 40, decoration: BoxDecoration(color: kAccent, borderRadius: BorderRadius.circular(10))),
              const SizedBox(width: 10),
              const Expanded(
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text('Presyo ng Hayop', style: TextStyle(fontSize: 22, fontWeight: FontWeight.w700)),
                  Muted('Running livestock prices. Sell to verified buyers.'),
                ]),
              ),
            ]),
            const SizedBox(height: 24),
            if (_challenge == null) ...[
              TextField(
                controller: _phone,
                keyboardType: TextInputType.phone,
                autofillHints: const [AutofillHints.telephoneNumber],
                decoration: const InputDecoration(labelText: 'Mobile number', hintText: '0917 123 4567', helperText: 'We text a 6-digit code.'),
              ),
              const SizedBox(height: 14),
              FilledButton(onPressed: _busy || _phone.text.replaceAll(RegExp(r'\D'), '').length < 10 ? null : _send, child: Text(_busy ? 'Sending…' : 'Send code')),
              const SizedBox(height: 8),
              const Muted('By continuing you agree that your number, name and documents are used to verify you as a farmer, buyer or hauler.'),
              const SizedBox(height: 20),
              TextButton(onPressed: () => setState(() => _showServer = !_showServer), child: Text(_showServer ? 'Hide server' : 'Server settings')),
              if (_showServer)
                TextField(controller: _server, keyboardType: TextInputType.url, decoration: const InputDecoration(labelText: 'API address', helperText: 'The PC running the API, on the same Wi-Fi. Ends in /v1.')),
            ] else ...[
              Text('Code sent to ${_normalise(_phone.text)}', style: const TextStyle(fontWeight: FontWeight.w600)),
              const Muted('Valid for 5 minutes. 5 wrong tries lock the code.'),
              const SizedBox(height: 10),
              TextField(
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                autofocus: true,
                autofillHints: const [AutofillHints.oneTimeCode],
                textAlign: TextAlign.center,
                style: const TextStyle(fontSize: 28, letterSpacing: 8),
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(counterText: ''),
              ),
              const SizedBox(height: 14),
              FilledButton(onPressed: _busy || _code.text.length != 6 ? null : _verify, child: Text(_busy ? 'Checking…' : 'Continue')),
              Row(children: [
                TextButton(onPressed: _busy || _resendIn > 0 ? null : _send, child: Text(_resendIn > 0 ? 'Resend in ${_resendIn}s' : 'Resend code')),
                TextButton(onPressed: () => setState(() => _challenge = null), child: const Text('Change number')),
              ]),
            ],
          ],
        ),
      ),
    );
  }
}

import 'package:flutter/material.dart';

import 'api/api.dart';
import 'api/client.dart';
import 'api/models.dart';
import 'screens/register.dart';
import 'screens/shell.dart';
import 'screens/sign_in.dart';
import 'ui.dart';

// Presyo ng Hayop, farmer app. Phase 1 of docs/development-plan.md: sign in,
// register, price board, herd, listings and offers, deals, profile.
Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await ApiClient.instance.init();
  runApp(const PresyoApp());
}

class PresyoApp extends StatefulWidget {
  const PresyoApp({super.key});
  @override
  State<PresyoApp> createState() => _PresyoAppState();
}

class _PresyoAppState extends State<PresyoApp> {
  User? _user;
  bool _ready = false;

  @override
  void initState() {
    super.initState();
    ApiClient.instance.onSessionLost = () => setState(() => _user = null);
    _restore();
  }

  Future<void> _restore() async {
    if (ApiClient.instance.signedIn) {
      try {
        _user = await Api.me();
      } catch (_) {
        await ApiClient.instance.clearTokens();
      }
    }
    if (mounted) setState(() => _ready = true);
  }

  Future<void> _reload() async {
    // Refresh tokens so new roles and verification land in the claims, then re-read the profile.
    await ApiClient.instance.refresh();
    final u = await Api.me();
    if (mounted) setState(() => _user = u);
  }

  Future<void> _signOut() async {
    await Api.logout();
    if (mounted) setState(() => _user = null);
  }

  @override
  Widget build(BuildContext context) {
    Widget home;
    if (!_ready) {
      home = const Scaffold(body: Center(child: CircularProgressIndicator()));
    } else if (_user == null) {
      home = SignInScreen(onSignedIn: (u) => setState(() => _user = u));
    } else if (_user!.needsProfile) {
      home = RegisterScreen(user: _user!, onDone: _reload);
    } else {
      home = ShellScreen(user: _user!, onReload: _reload, onSignOut: _signOut);
    }
    return MaterialApp(title: 'Presyo ng Hayop', theme: buildTheme(), debugShowCheckedModeBanner: false, home: home);
  }
}

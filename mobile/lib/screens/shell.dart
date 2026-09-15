import 'package:flutter/material.dart';

import '../api/models.dart';
import 'board.dart';
import 'deals.dart';
import 'herd.dart';
import 'me.dart';
import 'sell.dart';

/// Bottom tabs for the farmer: Presyo, Hayop, Ibenta, Deals, Ako.
class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key, required this.user, required this.onReload, required this.onSignOut});
  final User user;
  final Future<void> Function() onReload;
  final Future<void> Function() onSignOut;
  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _ShellScreenState extends State<ShellScreen> {
  int _tab = 0;

  @override
  Widget build(BuildContext context) {
    final u = widget.user;
    final pages = [
      const BoardScreen(),
      const HerdScreen(),
      SellScreen(user: u),
      DealsScreen(user: u),
      MeScreen(user: u, onReload: widget.onReload, onSignOut: widget.onSignOut),
    ];
    return Scaffold(
      body: Column(children: [
        if (!u.verified)
          MaterialBanner(
            padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
            backgroundColor: u.verification == 'pending' ? const Color(0xFFE3EBF3) : const Color(0xFFF6E7DF),
            content: Text(
              u.verification == 'pending'
                  ? 'Account under review, usually 2 working days. You can browse prices meanwhile.'
                  : u.verification == 'rejected'
                      ? 'Verification rejected${u.verificationNotes != null ? ': ${u.verificationNotes}' : ''}. Fix the documents under Ako.'
                      : 'Account suspended. Contact support.',
              style: const TextStyle(fontSize: 13),
            ),
            actions: const [SizedBox.shrink()],
          ),
        Expanded(child: SafeArea(top: false, child: pages[_tab])),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: _tab,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: const [
          NavigationDestination(icon: Icon(Icons.show_chart), label: 'Presyo'),
          NavigationDestination(icon: Icon(Icons.pets_outlined), label: 'Hayop'),
          NavigationDestination(icon: Icon(Icons.sell_outlined), label: 'Ibenta'),
          NavigationDestination(icon: Icon(Icons.handshake_outlined), label: 'Deals'),
          NavigationDestination(icon: Icon(Icons.person_outline), label: 'Ako'),
        ],
      ),
    );
  }
}

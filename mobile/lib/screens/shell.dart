import 'package:flutter/material.dart';

import '../api/models.dart';
import 'board.dart';
import 'deals.dart';
import 'herd.dart';
import 'jobs.dart';
import 'market.dart';
import 'me.dart';
import 'sell.dart';
import 'trips.dart';

/// Bottom tabs, one set per role, mirroring web-app/src/ui/Shell.tsx. Someone
/// who is both a farmer and a buyer sees both sets merged, with Presyo, Deals
/// and Ako appearing once.
class ShellScreen extends StatefulWidget {
  const ShellScreen({super.key, required this.user, required this.onReload, required this.onSignOut});
  final User user;
  final Future<void> Function() onReload;
  final Future<void> Function() onSignOut;
  @override
  State<ShellScreen> createState() => _ShellScreenState();
}

class _Tab {
  const _Tab(this.key, this.label, this.icon, this.build);
  final String key, label;
  final IconData icon;
  final Widget Function(_ShellScreenState s) build;
}

// Per-role tab sets. Keys are shared where two roles want the same screen, so
// the merge below can drop the duplicate.
const _tabsByRole = <String, List<_Tab>>{
  'farmer': [_board, _herd, _sell, _deals],
  'buyer': [_board, _market, _deals],
  'hauler': [_board, _jobs, _trips],
};
const _board = _Tab('board', 'Presyo', Icons.show_chart, _buildBoard);
const _herd = _Tab('herd', 'Hayop', Icons.pets_outlined, _buildHerd);
const _sell = _Tab('sell', 'Ibenta', Icons.sell_outlined, _buildSell);
const _market = _Tab('market', 'Bilhin', Icons.storefront_outlined, _buildMarket);
const _jobs = _Tab('jobs', 'Trabaho', Icons.local_shipping_outlined, _buildJobs);
const _trips = _Tab('trips', 'Biyahe', Icons.route_outlined, _buildTrips);
const _deals = _Tab('deals', 'Deals', Icons.handshake_outlined, _buildDeals);
const _me = _Tab('me', 'Ako', Icons.person_outline, _buildMe);

Widget _buildBoard(_ShellScreenState s) => const BoardScreen();
Widget _buildHerd(_ShellScreenState s) => const HerdScreen();
Widget _buildSell(_ShellScreenState s) => SellScreen(user: s.widget.user);
Widget _buildMarket(_ShellScreenState s) => MarketScreen(user: s.widget.user);
Widget _buildJobs(_ShellScreenState s) => JobsScreen(user: s.widget.user);
Widget _buildTrips(_ShellScreenState s) => const TripsScreen();
Widget _buildDeals(_ShellScreenState s) => DealsScreen(user: s.widget.user);
Widget _buildMe(_ShellScreenState s) => MeScreen(user: s.widget.user, onReload: s.widget.onReload, onSignOut: s.widget.onSignOut);

/// The tabs a person sees, merged across their roles in a fixed role order and
/// each appearing once. A farmer who is also a buyer gets Presyo, Hayop,
/// Ibenta, Deals, Bilhin, Ako, with Presyo and Deals not repeated.
List<String> tabKeysFor(List<String> roles) {
  final seen = <String>{};
  final out = <String>[];
  for (final role in const ['farmer', 'buyer', 'hauler'].where(roles.contains)) {
    for (final t in _tabsByRole[role]!) {
      if (seen.add(t.key)) out.add(t.key);
    }
  }
  // Someone with no trade role yet, an admin say, still gets the board.
  if (out.isEmpty) out.add(_board.key);
  out.add(_me.key);
  return out;
}

final _byKey = {for (final t in [..._tabsByRole.values.expand((t) => t), _me]) t.key: t};

class _ShellScreenState extends State<ShellScreen> {
  int _tab = 0;

  List<_Tab> get _tabs => [for (final k in tabKeysFor(widget.user.roles)) _byKey[k]!];

  @override
  Widget build(BuildContext context) {
    final u = widget.user;
    final tabs = _tabs;
    // Roles can change while the app is open, so keep the index in range.
    final index = _tab.clamp(0, tabs.length - 1);
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
        Expanded(child: SafeArea(top: false, child: tabs[index].build(this))),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: index,
        onDestinationSelected: (i) => setState(() => _tab = i),
        destinations: [for (final t in tabs) NavigationDestination(icon: Icon(t.icon), label: t.label)],
      ),
    );
  }
}

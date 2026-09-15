import 'package:flutter/material.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../ui.dart';

const _stateFil = {'accepted': 'napagkasunduan', 'hauler_assigned': 'may hauler', 'in_transit': 'biyahe', 'delivered': 'naihatid', 'settled': 'bayad na', 'disputed': 'may reklamo', 'refunded': 'na-refund', 'cancelled': 'kanselado'};
String _tone(String s) => switch (s) { 'settled' => 'ok', 'delivered' || 'disputed' => 'warn', 'refunded' || 'cancelled' => 'muted', _ => 'info' };

/// Wireframe Deal, farmer side: the agreed sale, the deposit line, the
/// hauler's progress, and the steps that are mine: confirm the payment
/// arrived, dispute, cancel, rate.
class DealsScreen extends StatefulWidget {
  const DealsScreen({super.key, required this.user});
  final User user;
  @override
  State<DealsScreen> createState() => _DealsScreenState();
}

class _DealsScreenState extends State<DealsScreen> {
  List<Deal>? _deals;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.deals();
      if (mounted) {
        setState(() {
          _deals = d;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final ds = _deals;
    return Scaffold(
      appBar: AppBar(title: const Text('Deals')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (_error != null) Note(_error!, warn: true),
            if (ds == null) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
            if (ds != null && ds.isEmpty) const EmptyText('No deals yet. A deal starts when you accept an offer.'),
            for (final d in ds ?? const <Deal>[])
              Panel(
                onTap: () async {
                  await Navigator.push(context, MaterialPageRoute(builder: (_) => DealDetailScreen(id: d.id, user: widget.user)));
                  _load();
                },
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    Text('${speciesLabel[d.species] ?? d.species} ${d.weightClassLabel ?? ''} × ${d.agreedHeads}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    StatusPill(_stateFil[d.state] ?? d.state, tone: _tone(d.state)),
                  ]),
                  Muted('${money(d.agreedPrice)}${unitLabel(d.unit)} · buyer ${d.buyerName} · ${day(d.acceptedAt.substring(0, 10))}'),
                  if (d.deposit?.status == 'pending') Text('Waiting for the buyer\'s deposit of ${money(d.deposit!.amount)}', style: const TextStyle(fontSize: 13, color: kWarn)),
                  if (d.state == 'delivered' && d.buyerPaidAt != null) const Text('Buyer says they paid. Confirm when you have it.', style: TextStyle(fontSize: 13, color: kAccent)),
                ]),
              ),
          ],
        ),
      ),
    );
  }
}

class DealDetailScreen extends StatefulWidget {
  const DealDetailScreen({super.key, required this.id, required this.user});
  final String id;
  final User user;
  @override
  State<DealDetailScreen> createState() => _DealDetailScreenState();
}

class _DealDetailScreenState extends State<DealDetailScreen> {
  Deal? _d;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.deal(widget.id);
      if (mounted) setState(() => _d = d);
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _run(Future<void> Function() fn, {String? done}) async {
    setState(() => _busy = true);
    try {
      await fn();
      if (done != null && mounted) showNote(context, done);
      await _load();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<String?> _ask(String title, String label, {String? warning}) => showDialog<String>(
        context: context,
        builder: (ctx) {
          final ctl = TextEditingController();
          return AlertDialog(
            title: Text(title),
            content: Column(mainAxisSize: MainAxisSize.min, children: [
              if (warning != null) Note(warning, warn: true),
              TextField(controller: ctl, maxLines: 3, decoration: InputDecoration(labelText: label)),
            ]),
            actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Back')), FilledButton(onPressed: () => Navigator.pop(ctx, ctl.text.trim()), child: const Text('Send'))],
          );
        },
      );

  @override
  Widget build(BuildContext context) {
    final d = _d;
    if (d == null) return Scaffold(appBar: AppBar(title: const Text('Deal')), body: const Center(child: CircularProgressIndicator()));
    final dep = d.deposit;
    final isFarmer = d.farmerId == widget.user.id;
    return Scaffold(
      appBar: AppBar(title: Text('${speciesLabel[d.species] ?? d.species} × ${d.agreedHeads}')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Panel(
              child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [StatusPill(_stateFil[d.state] ?? d.state, tone: _tone(d.state)), Muted(d.locationName)]),
                const SizedBox(height: 8),
                _fact('Agreed', '${money(d.agreedPrice)}${unitLabel(d.unit)} × ${d.agreedHeads}${d.agreedWeightKg != null ? ' · ${d.agreedWeightKg} kg declared' : ''}${d.estimatedTotal != null ? ' · est. ${money(d.estimatedTotal)}' : ''}'),
                _fact('Buyer', d.buyerName),
                if (d.deliveredHeads != null) _fact('Delivered', '${d.deliveredHeads} heads${d.deliveredWeightKg != null ? ' · ${d.deliveredWeightKg} kg weighed' : ''} · ${money(d.finalTotal)}'),
                _fact('Hauling', !d.needsHauler ? 'buyer brings own truck' : d.haulerLine ?? 'waiting for a hauler'),
                if (d.depositRequired) _fact('Deposit', dep == null ? 'being prepared' : '${money(dep.amount)} · ${dep.status}${dep.paidAt != null ? ' ${when(dep.paidAt)}' : dep.status == 'pending' ? ' · pay by ${when(dep.expiresAt)}' : ''}'),
                if (d.paymentMethod != null) _fact('Balance', '${d.paymentMethod}${d.paymentReference != null ? ' ref ${d.paymentReference}' : ''} · ${when(d.buyerPaidAt)}${d.farmerConfirmedAt != null ? ' · confirmed ${when(d.farmerConfirmedAt)}' : ' · not yet confirmed'}'),
                if (d.cancelReason != null) _fact('Cancelled', d.cancelReason!),
              ]),
            ),
            if (isFarmer && dep?.status == 'pending') Note('Waiting for the buyer\'s deposit of ${money(dep!.amount)}. Prepare the animals once it is paid.'),
            if (isFarmer && dep?.status == 'paid' && ['accepted', 'hauler_assigned', 'in_transit'].contains(d.state))
              Note('${money(dep!.amount)} reserved for you, paid by the buyer and held through PayMongo. Released to your payout account when the deal settles.'),
            if (isFarmer && d.state == 'delivered')
              Panel(
                title: 'Payment',
                child: d.buyerPaidAt != null
                    ? Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                        Text('The buyer says they paid ${money(d.finalTotal)} by ${d.paymentMethod}${d.paymentReference != null ? ' (ref ${d.paymentReference})' : ''}. Confirm only when the money is in your hands or account.', style: const TextStyle(fontSize: 14)),
                        const SizedBox(height: 10),
                        FilledButton(onPressed: _busy ? null : () => _run(() => Api.confirmPayment(d.id), done: 'Deal settled. Salamat!'), child: const Text('Natanggap ko na ang bayad')),
                      ])
                    : Muted('Delivered: ${d.deliveredHeads} heads. Waiting for the buyer to record the payment.'),
              ),
            if (d.state == 'delivered')
              OutlinedButton(
                onPressed: _busy
                    ? null
                    : () async {
                        final t = await _ask('Open a dispute', 'What happened? An admin decides with both sides\' figures.');
                        if (t != null && t.length >= 3) await _run(() => Api.dispute(d.id, 'other', t), done: 'Dispute opened. An admin will review it.');
                      },
                child: const Text('May problema (dispute)'),
              ),
            if (['accepted', 'hauler_assigned'].contains(d.state))
              TextButton(
                onPressed: _busy
                    ? null
                    : () async {
                        final r = await _ask('Cancel the deal', 'Reason (the buyer reads this)', warning: dep?.status == 'paid' ? 'The buyer is refunded in full and you get a strike.' : null);
                        if (r != null && r.length >= 3) await _run(() => Api.cancelDeal(d.id, r));
                      },
                child: const Text('Cancel this deal', style: TextStyle(color: kWarn)),
              ),
            if (d.state == 'settled')
              Panel(
                title: 'Rate the buyer',
                child: Row(children: [
                  for (var n = 1; n <= 5; n++)
                    IconButton(onPressed: _busy ? null : () => _run(() => Api.rate(d.id, n), done: 'Rating saved.'), icon: const Icon(Icons.star_border), tooltip: '$n'),
                ]),
              ),
            const SectionTitle('Timeline'),
            for (final e in d.events)
              ListTile(
                dense: true,
                contentPadding: EdgeInsets.zero,
                leading: const Icon(Icons.circle, size: 10, color: kAccent),
                title: Text('${_stateFil[e.toState] ?? e.toState}${e.note != null ? ' · ${e.note}' : ''}', style: const TextStyle(fontSize: 14)),
                subtitle: Muted(when(e.createdAt)),
              ),
          ],
        ),
      ),
    );
  }

  Widget _fact(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [SizedBox(width: 90, child: Muted(k, size: 14)), Expanded(child: Text(v, style: const TextStyle(fontSize: 14)))]),
      );
}

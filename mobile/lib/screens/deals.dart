import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../ui.dart';

const _stateFil = {'accepted': 'napagkasunduan', 'hauler_assigned': 'may hauler', 'in_transit': 'biyahe', 'delivered': 'naihatid', 'settled': 'bayad na', 'disputed': 'may reklamo', 'refunded': 'na-refund', 'cancelled': 'kanselado'};
String _tone(String s) => switch (s) { 'settled' => 'ok', 'delivered' || 'disputed' => 'warn', 'refunded' || 'cancelled' => 'muted', _ => 'info' };

/// Wireframe Deal, both sides of it: the agreed sale, the deposit line, the
/// hauler's progress, and the steps that are the reader's own. A farmer
/// confirms the payment arrived; a buyer pays the deposit, confirms what
/// arrived and records the balance.
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
                  Muted('${money(d.agreedPrice)}${unitLabel(d.unit)} · ${d.farmerId == widget.user.id ? 'buyer ${d.buyerName}' : 'farmer ${d.farmerName}'} · ${day(d.acceptedAt.substring(0, 10))}'),
                  if (d.deposit?.status == 'pending')
                    Text(
                      d.buyerId == widget.user.id ? 'Pay your deposit of ${money(d.deposit!.amount)} by ${when(d.deposit!.expiresAt)}' : 'Waiting for the buyer\'s deposit of ${money(d.deposit!.booking)}',
                      style: const TextStyle(fontSize: 13, color: kWarn),
                    ),
                  if (d.state == 'delivered' && d.buyerPaidAt != null && d.farmerId == widget.user.id) const Text('Buyer says they paid. Confirm when you have it.', style: TextStyle(fontSize: 13, color: kAccent)),
                  if (d.buyerId == widget.user.id && ['accepted', 'in_transit'].contains(d.state) && d.deposit?.status != 'pending') const Text('Confirm what arrives when the animals reach you.', style: TextStyle(fontSize: 13, color: kAccent)),
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
  Deposit? _dep;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final d = await Api.deal(widget.id);
      // The deal carries the amounts; only the deposit record carries the
      // checkout link, and asking for it is pointless unless one is due.
      Deposit? dep;
      if (d.depositRequired && d.buyerId == widget.user.id) {
        try {
          dep = await Api.deposit(widget.id);
        } catch (_) {
          dep = null;
        }
      }
      if (mounted) {
        setState(() {
          _d = d;
          _dep = dep;
        });
      }
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
    final dep = _dep ?? d.deposit;
    final isFarmer = d.farmerId == widget.user.id;
    final isBuyer = d.buyerId == widget.user.id;
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
                _fact(isFarmer ? 'Buyer' : 'Farmer', isFarmer ? d.buyerName : d.farmerName),
                if (d.deliveredHeads != null) _fact('Delivered', '${d.deliveredHeads} heads${d.deliveredWeightKg != null ? ' · ${d.deliveredWeightKg} kg weighed' : ''} · ${money(d.finalTotal)}'),
                _fact('Hauling', !d.needsHauler ? 'buyer brings own truck' : d.haulerLine ?? 'waiting for a hauler'),
                if (d.depositRequired) _fact('Deposit', dep == null ? 'being prepared' : '${money(dep.amount)}${dep.hasCommission ? ' (${money(dep.booking)} deposit plus ${money(dep.commission)} platform fee)' : ''} · ${dep.status}${dep.paidAt != null ? ' ${when(dep.paidAt)}' : dep.status == 'pending' ? ' · pay by ${when(dep.expiresAt)}' : ''}'),
                if (d.paymentMethod != null) _fact('Balance', '${d.paymentMethod}${d.paymentReference != null ? ' ref ${d.paymentReference}' : ''} · ${when(d.buyerPaidAt)}${d.farmerConfirmedAt != null ? ' · confirmed ${when(d.farmerConfirmedAt)}' : ' · not yet confirmed'}'),
                if (d.cancelReason != null) _fact('Cancelled', d.cancelReason!),
              ]),
            ),
            if (isFarmer && dep?.status == 'pending') Note('Waiting for the buyer\'s deposit of ${money(dep!.booking)}. Prepare the animals once it is paid.'),
            if (isFarmer && dep?.status == 'paid' && ['accepted', 'hauler_assigned', 'in_transit'].contains(d.state))
              Note('${money(dep!.booking)} reserved for you, paid by the buyer and held through PayMongo. Released to your payout account when the deal settles.'),
            if (isBuyer && dep?.status == 'pending')
              Panel(
                title: 'Pay the booking deposit',
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text(
                    '${money(dep!.amount)} holds the animals for you${dep.hasCommission ? ', of which ${money(dep.booking)} is the deposit that counts toward the price and ${money(dep.commission)} is the platform fee' : ', and it counts toward the price'}. Pay by ${when(dep.expiresAt)} or the deal lapses. The balance is paid at delivery.',
                    style: const TextStyle(fontSize: 14),
                  ),
                  const SizedBox(height: 10),
                  if (_dep?.checkoutUrl != null)
                    FilledButton(
                      onPressed: _busy ? null : () => _openCheckout(_dep!.checkoutUrl!),
                      child: Text('Pay ${money(dep.amount)} with GCash / Maya / QR Ph'),
                    )
                  else
                    FilledButton(onPressed: _busy ? null : () => _run(() => Api.refreshCheckout(d.id)), child: const Text('Get payment link')),
                  TextButton(onPressed: _busy ? null : _load, child: const Text('I have paid, refresh')),
                ]),
              ),
            if (isBuyer && ['accepted', 'in_transit'].contains(d.state) && dep?.status != 'pending')
              _ReceiveForm(d: d, busy: _busy, onSubmit: (v) => _run(() => Api.deliverDeal(d.id, v), done: 'Delivery recorded. Pay the farmer next.')),
            if (isBuyer && d.state == 'delivered' && d.buyerPaidAt == null)
              _PayForm(
                total: d.finalTotal,
                deposit: dep?.status == 'paid' || dep?.status == 'released' ? dep!.amount : null,
                busy: _busy,
                onSubmit: (method, ref) => _run(() => Api.payDeal(d.id, method, ref), done: 'Recorded. The farmer confirms when the money lands.'),
              ),
            if (isBuyer && d.state == 'delivered' && d.buyerPaidAt != null)
              Note('You recorded ${money(d.finalTotal)} by ${d.paymentMethod}. Waiting for ${d.farmerName} to confirm it arrived.'),
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
                        final r = await _ask(
                          'Cancel the deal',
                          isFarmer ? 'Reason (the buyer reads this)' : 'Reason (the farmer reads this)',
                          warning: dep?.status != 'paid'
                              ? null
                              : isFarmer
                                  ? 'The buyer is refunded in full and you get a strike.'
                                  : 'Your deposit of ${money(dep!.amount)} goes to the farmer if you cancel now.',
                        );
                        if (r != null && r.length >= 3) await _run(() => Api.cancelDeal(d.id, r));
                      },
                child: const Text('Cancel this deal', style: TextStyle(color: kWarn)),
              ),
            if (d.state == 'settled')
              Panel(
                title: isFarmer ? 'Rate the buyer' : 'Rate the farmer',
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

  Future<void> _openCheckout(String url) async {
    try {
      final ok = await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      if (!ok) throw Exception('No app on this phone can open the payment page.');
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Widget _fact(String k, String v) => Padding(
        padding: const EdgeInsets.symmetric(vertical: 3),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [SizedBox(width: 90, child: Muted(k, size: 14)), Expanded(child: Text(v, style: const TextStyle(fontSize: 14)))]),
      );
}


/// Wireframe BuyerReceive: count the heads, weigh at the scale if the price is
/// per kilo. This is what sets the final price, so it is the buyer's to enter.
class _ReceiveForm extends StatefulWidget {
  const _ReceiveForm({required this.d, required this.busy, required this.onSubmit});
  final Deal d;
  final bool busy;
  final void Function(Map<String, dynamic>) onSubmit;
  @override
  State<_ReceiveForm> createState() => _ReceiveFormState();
}

class _ReceiveFormState extends State<_ReceiveForm> {
  late final _heads = TextEditingController(text: '${widget.d.agreedHeads}');
  final _kg = TextEditingController();
  final _note = TextEditingController();

  bool get _perHead => widget.d.unit == 'per_head';

  double? get _total {
    final price = double.tryParse(widget.d.agreedPrice);
    if (price == null) return null;
    if (_perHead) {
      final h = int.tryParse(_heads.text);
      return h == null ? null : price * h;
    }
    final kg = double.tryParse(_kg.text);
    return kg == null ? null : price * kg;
  }

  @override
  Widget build(BuildContext context) {
    final total = _total;
    return Panel(
      title: 'Confirm what arrived',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Muted('Count the heads${_perHead ? '' : ' and weigh at the scale'}. This sets the final price.'),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: TextField(controller: _heads, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Heads received'), onChanged: (_) => setState(() {}))),
          if (!_perHead) ...[
            const SizedBox(width: 10),
            Expanded(
              child: TextField(
                controller: _kg,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: const InputDecoration(labelText: 'Total weight, kg'),
                onChanged: (_) => setState(() {}),
              ),
            ),
          ],
        ]),
        const SizedBox(height: 12),
        TextField(controller: _note, maxLength: 500, decoration: const InputDecoration(labelText: 'Note (optional)', counterText: '')),
        FilledButton(
          onPressed: widget.busy || total == null
              ? null
              : () => widget.onSubmit({
                    'delivered_heads': int.parse(_heads.text),
                    'delivered_weight_kg': _perHead ? null : _kg.text.trim(),
                    'note': _note.text.trim().isEmpty ? null : _note.text.trim(),
                  }),
          child: Text(total == null ? 'Enter what arrived' : 'Confirm delivery · ${money(total.toStringAsFixed(2))}'),
        ),
      ]),
    );
  }
}

/// Wireframe BuyerPay: the balance is paid farmer to buyer directly, outside
/// the app, so this only records what was paid and how.
class _PayForm extends StatefulWidget {
  const _PayForm({required this.total, required this.deposit, required this.busy, required this.onSubmit});
  final String? total, deposit;
  final bool busy;
  final void Function(String method, String? reference) onSubmit;
  @override
  State<_PayForm> createState() => _PayFormState();
}

class _PayFormState extends State<_PayForm> {
  String _method = 'gcash';
  final _ref = TextEditingController();

  @override
  Widget build(BuildContext context) {
    final total = double.tryParse(widget.total ?? '');
    final dep = double.tryParse(widget.deposit ?? '');
    final due = total == null ? null : total - (dep ?? 0);
    return Panel(
      title: 'Pay the farmer',
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text(
          'Balance due ${due == null ? '—' : money(due.toStringAsFixed(2))}${dep == null ? '' : ' (${money(widget.total)} less your ${money(widget.deposit)} deposit)'}. Pay the farmer directly, then record it here.',
          style: const TextStyle(fontSize: 14),
        ),
        const SizedBox(height: 12),
        DropdownButtonFormField<String>(
          initialValue: _method,
          decoration: const InputDecoration(labelText: 'How'),
          items: const [
            DropdownMenuItem(value: 'gcash', child: Text('GCash')),
            DropdownMenuItem(value: 'bank', child: Text('Bank transfer')),
            DropdownMenuItem(value: 'cash', child: Text('Cash')),
          ],
          onChanged: (v) => setState(() => _method = v ?? 'gcash'),
        ),
        if (_method != 'cash') ...[
          const SizedBox(height: 12),
          TextField(controller: _ref, maxLength: 80, decoration: const InputDecoration(labelText: 'Reference number', counterText: '')),
        ],
        const SizedBox(height: 4),
        FilledButton(
          onPressed: widget.busy ? null : () => widget.onSubmit(_method, _ref.text.trim().isEmpty ? null : _ref.text.trim()),
          child: const Text('Nabayaran ko na ang magsasaka'),
        ),
      ]),
    );
  }
}

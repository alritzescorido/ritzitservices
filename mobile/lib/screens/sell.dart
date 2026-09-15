import 'package:flutter/material.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../ui.dart';

/// Wireframe Listing: pick a lot, set heads and price against the board, then
/// handle offers: accept, counter, decline.
class SellScreen extends StatefulWidget {
  const SellScreen({super.key, required this.user});
  final User user;
  @override
  State<SellScreen> createState() => _SellScreenState();
}

class _SellScreenState extends State<SellScreen> {
  List<Listing>? _listings;
  final Map<String, List<Offer>> _offers = {};
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final ls = await Api.myListings();
      final offers = <String, List<Offer>>{};
      for (final l in ls.where((l) => l.status == 'active')) {
        offers[l.id] = await Api.offers(l.id);
      }
      if (!mounted) return;
      setState(() {
        _listings = ls;
        _offers
          ..clear()
          ..addAll(offers);
        _error = null;
      });
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    }
  }

  Future<void> _act(Future<void> Function() fn, {String? done}) async {
    try {
      await fn();
      if (done != null && mounted) showNote(context, done);
      await _load();
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  Future<void> _counter(Offer o, Listing l) async {
    final ctl = TextEditingController(text: l.askingPrice);
    final price = await showDialog<String>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Counter offer'),
        content: TextField(controller: ctl, keyboardType: const TextInputType.numberWithOptions(decimal: true), decoration: InputDecoration(labelText: 'Your price ${unitLabel(l.unit)} for ${o.heads} heads')),
        actions: [TextButton(onPressed: () => Navigator.pop(ctx), child: const Text('Back')), FilledButton(onPressed: () => Navigator.pop(ctx, ctl.text), child: const Text('Send'))],
      ),
    );
    if (price == null) return;
    final n = double.tryParse(price);
    if (n == null) return;
    await _act(() => Api.counterOffer(o.id, n.toStringAsFixed(2), o.heads), done: 'Counter sent.');
  }

  @override
  Widget build(BuildContext context) {
    final ls = _listings;
    final verified = widget.user.verified;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Ibenta'),
        actions: [
          TextButton.icon(
            onPressed: !verified
                ? null
                : () async {
                    final ok = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => const _ListingSheet());
                    if (ok == true) _load();
                  },
            icon: const Icon(Icons.add),
            label: const Text('Listing'),
          ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (!verified) const Note('Listing opens once your account is verified.'),
            if (_error != null) Note(_error!, warn: true),
            if (ls == null) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
            if (ls != null && ls.isEmpty) const EmptyText('No listings yet.'),
            for (final l in ls ?? const <Listing>[])
              Panel(
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    Text('${speciesLabel[l.species] ?? l.species} ${l.weightClass.label} × ${l.headsOffered}', style: const TextStyle(fontWeight: FontWeight.w600)),
                    StatusPill(l.status, tone: l.status == 'active' ? 'ok' : l.status == 'matched' ? 'info' : 'muted'),
                  ]),
                  Muted(
                    'Asking ${money(l.askingPrice)}${unitLabel(l.unit)}'
                    '${l.boardPrice != null ? ' · board ${money(l.boardPrice)} (${l.vsBoardPct != null && l.vsBoardPct! >= 0 ? '+' : ''}${l.vsBoardPct?.toStringAsFixed(1) ?? '—'}%)' : ''}'
                    '${l.estimatedTotal != null ? ' · est. ${money(l.estimatedTotal)}' : ''}',
                  ),
                  if ((_offers[l.id] ?? const []).isNotEmpty) const SectionTitle('Offers'),
                  for (final o in _offers[l.id] ?? const <Offer>[]) _offerRow(o, l),
                  if (l.status == 'active' && (_offers[l.id] ?? const []).isEmpty) const Padding(padding: EdgeInsets.only(top: 6), child: Muted('No offers yet. Buyers have 24 hours per offer.')),
                ]),
              ),
          ],
        ),
      ),
    );
  }

  Widget _offerRow(Offer o, Listing l) {
    final mine = o.offeredBy == 'farmer';
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(border: Border.all(color: const Color(0xFFD5DAD3)), borderRadius: BorderRadius.circular(8)),
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Text('${money(o.price)}${unitLabel(l.unit)} × ${o.heads}', style: const TextStyle(fontWeight: FontWeight.w600)),
          StatusPill(o.status, tone: o.status == 'pending' ? 'info' : o.status == 'accepted' ? 'ok' : 'muted'),
        ]),
        Muted('${mine ? 'Your counter to ' : ''}${o.buyerName}${o.estimatedTotal != null ? ' · ${money(o.estimatedTotal)}' : ''}${o.pickupOn != null ? ' · pickup ${day(o.pickupOn)}' : ''} · ${o.needsHauler ? 'wants a hauler' : 'own truck'}'),
        if (o.note != null) Text('“${o.note}”', style: const TextStyle(fontSize: 13)),
        if (o.status == 'pending' && !mine)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: Row(children: [
              FilledButton(
                style: FilledButton.styleFrom(minimumSize: const Size(0, 40)),
                onPressed: () => _act(() => Api.acceptOffer(o.id), done: 'Deal agreed. See Deals.'),
                child: const Text('Accept'),
              ),
              const SizedBox(width: 8),
              OutlinedButton(style: OutlinedButton.styleFrom(minimumSize: const Size(0, 40)), onPressed: () => _counter(o, l), child: const Text('Counter')),
              const SizedBox(width: 8),
              TextButton(onPressed: () => _act(() => Api.rejectOffer(o.id)), child: const Text('Decline', style: TextStyle(color: kWarn))),
            ]),
          ),
        if (o.status == 'pending' && mine) const Muted('Waiting for the buyer.'),
      ]),
    );
  }
}

class _ListingSheet extends StatefulWidget {
  const _ListingSheet();
  @override
  State<_ListingSheet> createState() => _ListingSheetState();
}

class _ListingSheetState extends State<_ListingSheet> {
  List<Lot> _lots = const [];
  Lot? _lot;
  final _heads = TextEditingController();
  final _price = TextEditingController();
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _loadLots();
  }

  Future<void> _loadLots() async {
    try {
      final farms = await Api.farms();
      final all = <Lot>[];
      for (final f in farms) {
        all.addAll(await Api.lots(f.id));
      }
      if (!mounted) return;
      setState(() {
        _lots = all;
        _lot = all.isEmpty ? null : all.first;
        if (_lot != null) _heads.text = '${_lot!.headCount}';
      });
    } catch (e) {
      if (mounted) showError(context, e);
    }
  }

  double? get _estimate {
    final l = _lot;
    final p = double.tryParse(_price.text);
    final h = int.tryParse(_heads.text);
    if (l == null || p == null || h == null) return null;
    if (l.weightClass.unit == 'per_head') return p * h;
    final w = double.tryParse(l.avgWeightKg ?? '');
    return w == null ? null : p * w * h;
  }

  @override
  Widget build(BuildContext context) {
    final est = _estimate;
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        const Text('New listing', style: TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
        const SizedBox(height: 12),
        if (_lots.isEmpty) const Muted('Add a lot under Hayop first.'),
        if (_lots.isNotEmpty)
          DropdownButtonFormField<Lot>(
            initialValue: _lot,
            decoration: const InputDecoration(labelText: 'Lot'),
            items: [for (final l in _lots) DropdownMenuItem(value: l, child: Text('${speciesLabel[l.species]} ${l.weightClass.label} × ${l.headCount}${l.avgWeightKg != null ? ' (avg ${l.avgWeightKg} kg)' : ''}'))],
            onChanged: (l) => setState(() {
              _lot = l;
              if (l != null) _heads.text = '${l.headCount}';
            }),
          ),
        const SizedBox(height: 12),
        Row(children: [
          Expanded(child: TextField(controller: _heads, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Heads to sell'), onChanged: (_) => setState(() {}))),
          const SizedBox(width: 10),
          Expanded(
            child: TextField(
              controller: _price,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: InputDecoration(labelText: 'Price ${_lot != null ? unitLabel(_lot!.weightClass.unit) : ''}', helperText: est != null ? 'est. ${money(est.toStringAsFixed(2))}' : 'Check the board first'),
              onChanged: (_) => setState(() {}),
            ),
          ),
        ]),
        const SizedBox(height: 14),
        FilledButton(
          onPressed: _busy || _lot == null || int.tryParse(_heads.text) == null || double.tryParse(_price.text) == null
              ? null
              : () async {
                  setState(() => _busy = true);
                  try {
                    await Api.createListing(_lot!.id, int.parse(_heads.text), double.parse(_price.text).toStringAsFixed(2));
                    if (context.mounted) Navigator.pop(context, true);
                  } catch (e) {
                    if (context.mounted) showError(context, e);
                  } finally {
                    if (mounted) setState(() => _busy = false);
                  }
                },
          child: Text(_busy ? 'Posting…' : 'Post listing'),
        ),
      ]),
    );
  }
}

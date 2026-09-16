import 'package:flutter/material.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../ui.dart';
import 'widgets/location_picker.dart';

/// Wireframes BuyerBrowse and BuyerOffer: what is for sale near me, each price
/// next to the board so the buyer can see whether it is dear, then an offer
/// with a pickup day, whether a hauler is wanted, and where to deliver.
class MarketScreen extends StatefulWidget {
  const MarketScreen({super.key, required this.user});
  final User user;
  @override
  State<MarketScreen> createState() => _MarketScreenState();
}

class _MarketScreenState extends State<MarketScreen> {
  List<Listing>? _items;
  String _species = '';
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final r = await Api.browse(species: _species.isEmpty ? null : _species);
      if (mounted) {
        setState(() {
          _items = r;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final items = _items;
    return Scaffold(
      appBar: AppBar(title: const Text('Bilhin')),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (!widget.user.verified) const Note('Offers open once your account is verified.'),
            if (_error != null) Note(_error!, warn: true),
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
                ChoiceChip(label: const Text('Lahat'), selected: _species.isEmpty, onSelected: (_) => _pick('')),
                for (final s in speciesAll) ...[
                  const SizedBox(width: 6),
                  ChoiceChip(label: Text(speciesLabel[s]!), selected: _species == s, onSelected: (_) => _pick(s)),
                ],
              ]),
            ),
            const SizedBox(height: 10),
            if (items == null) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
            if (items != null && items.isEmpty) const EmptyText('Nothing listed right now. Pull down to refresh.'),
            for (final l in items ?? const <Listing>[]) _ListingCard(l: l, canOffer: widget.user.verified, onOffered: _load),
          ],
        ),
      ),
    );
  }

  void _pick(String s) {
    setState(() {
      _species = s;
      _items = null;
    });
    _load();
  }
}

class _ListingCard extends StatelessWidget {
  const _ListingCard({required this.l, required this.canOffer, required this.onOffered});
  final Listing l;
  final bool canOffer;
  final Future<void> Function() onOffered;

  @override
  Widget build(BuildContext context) {
    final vs = l.vsBoardPct;
    return Panel(
      onTap: !canOffer
          ? null
          : () async {
              final sent = await showModalBottomSheet<bool>(context: context, isScrollControlled: true, builder: (_) => _OfferSheet(l: l));
              if (sent == true) await onOffered();
            },
      child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
          Expanded(child: Text('${speciesLabel[l.species] ?? l.species} ${l.weightClass.label} × ${l.headsOffered}', style: const TextStyle(fontWeight: FontWeight.w600))),
          Text('${money(l.askingPrice)}${unitLabel(l.unit)}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700)),
        ]),
        Row(children: [
          Expanded(child: Muted('${l.location?.displayName ?? ''} · ${l.farmName}, ${l.farmerName}')),
          if (l.farmerVerified) const StatusPill('verified', tone: 'ok'),
        ]),
        Muted([
          if (l.boardPrice != null) 'Board ${money(l.boardPrice)}${vs != null ? ' · ${vs >= 0 ? '+' : ''}${vs.toStringAsFixed(1)}%' : ''}' else 'No board price',
          if (l.avgWeightKg != null) 'avg ${l.avgWeightKg} kg',
          if (l.estimatedTotal != null) 'est. ${money(l.estimatedTotal)}',
          if (l.lastVaccinationOn != null) 'vaccinated ${day(l.lastVaccinationOn)}',
          if (l.pendingOffers > 0) '${l.pendingOffers} offer(s)',
        ].join(' · ')),
        if (canOffer) const Padding(padding: EdgeInsets.only(top: 6), child: Muted('Tap to make an offer.', size: 13)),
      ]),
    );
  }
}

class _OfferSheet extends StatefulWidget {
  const _OfferSheet({required this.l});
  final Listing l;
  @override
  State<_OfferSheet> createState() => _OfferSheetState();
}

class _OfferSheetState extends State<_OfferSheet> {
  late final _price = TextEditingController(text: widget.l.boardPrice ?? widget.l.askingPrice);
  late final _heads = TextEditingController(text: '${widget.l.headsOffered}');
  final _note = TextEditingController();
  DateTime? _pickupOn;
  bool _wantsHauler = true;
  Location? _dropoff;
  bool _busy = false;

  double? get _estimate {
    final p = double.tryParse(_price.text);
    final h = int.tryParse(_heads.text);
    if (p == null || h == null) return null;
    if (widget.l.unit == 'per_head') return p * h;
    final w = double.tryParse(widget.l.avgWeightKg ?? '');
    return w == null ? null : p * w * h;
  }

  @override
  Widget build(BuildContext context) {
    final est = _estimate;
    // The rate the platform charges is not public, so show the deposit only.
    final deposit = est == null ? null : (est * 0.1).clamp(2000, 20000);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: SingleChildScrollView(
        child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Text('Offer for ${speciesLabel[widget.l.species]} × ${widget.l.headsOffered}', style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w600)),
          Muted('${widget.l.farmName}, ${widget.l.farmerName}. Asking ${money(widget.l.askingPrice)}${unitLabel(widget.l.unit)}.'),
          const SizedBox(height: 12),
          Row(children: [
            Expanded(
              child: TextField(
                controller: _price,
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                decoration: InputDecoration(labelText: 'Your price ${unitLabel(widget.l.unit)}', helperText: est == null ? null : '≈ ${money(est.toStringAsFixed(2))}'),
                onChanged: (_) => setState(() {}),
              ),
            ),
            const SizedBox(width: 10),
            Expanded(child: TextField(controller: _heads, keyboardType: TextInputType.number, decoration: const InputDecoration(labelText: 'Heads'), onChanged: (_) => setState(() {}))),
          ]),
          const SizedBox(height: 12),
          InputDecorator(
            decoration: const InputDecoration(labelText: 'Pickup day'),
            child: Row(children: [
              Expanded(child: Text(_pickupOn == null ? 'Not set' : day(_pickupOn!.toIso8601String().substring(0, 10)))),
              TextButton(
                onPressed: () async {
                  final now = DateTime.now();
                  final d = await showDatePicker(context: context, firstDate: now, lastDate: now.add(const Duration(days: 60)), initialDate: now.add(const Duration(days: 2)));
                  if (d != null) setState(() => _pickupOn = d);
                },
                child: const Text('choose'),
              ),
            ]),
          ),
          const SizedBox(height: 4),
          SwitchListTile(
            contentPadding: EdgeInsets.zero,
            title: const Text('Book a hauler in the app', style: TextStyle(fontSize: 15)),
            subtitle: const Muted('Off means you bring your own truck.'),
            value: _wantsHauler,
            onChanged: (v) => setState(() => _wantsHauler = v),
          ),
          if (_wantsHauler) LocationPicker(level: 'municipality', label: 'Deliver to', value: _dropoff, onChanged: (l) => setState(() => _dropoff = l)),
          const SizedBox(height: 12),
          TextField(controller: _note, maxLength: 300, decoration: const InputDecoration(labelText: 'Note to the farmer (optional)', counterText: '')),
          if (deposit != null)
            Muted('If the farmer accepts, a booking deposit of about ${money(deposit.toStringAsFixed(2))} is due within 2 hours through GCash, Maya or QR Ph. It counts toward the price.'),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: _busy || _estimate == null
                ? null
                : () async {
                    setState(() => _busy = true);
                    try {
                      await Api.makeOffer(widget.l.id, {
                        'price': double.parse(_price.text).toStringAsFixed(2),
                        'heads': int.parse(_heads.text),
                        'pickup_on': _pickupOn?.toIso8601String().substring(0, 10),
                        'needs_hauler': _wantsHauler,
                        'dropoff_location_code': _dropoff?.code,
                        'note': _note.text.trim().isEmpty ? null : _note.text.trim(),
                      });
                      if (context.mounted) {
                        showNote(context, 'Offer sent. The farmer has 24 hours to answer.');
                        Navigator.pop(context, true);
                      }
                    } catch (e) {
                      if (context.mounted) showError(context, e);
                    } finally {
                      if (mounted) setState(() => _busy = false);
                    }
                  },
            child: Text(_busy ? 'Sending…' : 'Send offer'),
          ),
        ]),
      ),
    );
  }
}

import 'package:flutter/material.dart';

import '../api/api.dart';
import '../api/models.dart';
import '../ui.dart';
import 'trips.dart';

/// Wireframe HaulJobs: booked deals that want a truck, soonest pickup first.
/// A job only appears once the buyer's deposit is paid, so a hauler is never
/// sent to a farm for a deal that has not been committed to.
class JobsScreen extends StatefulWidget {
  const JobsScreen({super.key, required this.user});
  final User user;
  @override
  State<JobsScreen> createState() => _JobsScreenState();
}

class _JobsScreenState extends State<JobsScreen> {
  HaulerProfile? _profile;
  List<HaulJob>? _jobs;
  bool _fitsOnly = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final p = await Api.haulerProfile();
      final j = await Api.haulJobs(fitsMyTruck: _fitsOnly);
      if (mounted) {
        setState(() {
          _profile = p;
          _jobs = j;
          _error = null;
        });
      }
    } catch (e) {
      if (mounted) setState(() => _error = errorText(e));
    }
  }

  @override
  Widget build(BuildContext context) {
    final jobs = _jobs;
    final p = _profile;
    return Scaffold(
      appBar: AppBar(
        title: const Text('Trabaho'),
        actions: [
          Row(children: [
            const Muted('Kasya sa akin'),
            Switch(
              value: _fitsOnly,
              onChanged: (v) {
                setState(() {
                  _fitsOnly = v;
                  _jobs = null;
                });
                _load();
              },
            ),
          ]),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            if (p == null) const Note('Add your truck under Ako before you can take a job.', warn: true),
            if (p != null) Muted('${p.vehicleType} ${p.vehiclePlate} · up to ${p.capacityHeads} heads', size: 14),
            if (!widget.user.verified) const Note('You can take jobs once your OR/CR and ID are verified.'),
            if (_error != null) Note(_error!, warn: true),
            const SizedBox(height: 8),
            if (jobs == null) const Center(child: Padding(padding: EdgeInsets.all(24), child: CircularProgressIndicator())),
            if (jobs != null && jobs.isEmpty) const EmptyText('No open jobs. They appear once a buyer has paid their deposit.'),
            for (final j in jobs ?? const <HaulJob>[])
              Panel(
                onTap: p == null || !widget.user.verified || j.fitsCapacity == false
                    ? null
                    : () async {
                        final id = await showModalBottomSheet<String>(context: context, isScrollControlled: true, builder: (_) => _AcceptSheet(job: j, profile: p));
                        if (id != null && context.mounted) {
                          await Navigator.push(context, MaterialPageRoute(builder: (_) => TripDetailScreen(id: id)));
                          await _load();
                        }
                      },
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Row(mainAxisAlignment: MainAxisAlignment.spaceBetween, children: [
                    Expanded(child: Text('${j.heads} ${speciesLabel[j.species] ?? j.species}${j.estimatedWeightKg != null ? ' · ~${double.parse(j.estimatedWeightKg!).round()} kg' : ''}', style: const TextStyle(fontWeight: FontWeight.w600))),
                    if (j.fitsCapacity == false) const StatusPill('too big', tone: 'warn') else if (j.pickupOn != null) StatusPill(day(j.pickupOn), tone: 'info'),
                  ]),
                  Text('${j.farmName}, ${j.pickup.displayName}', style: const TextStyle(fontSize: 14)),
                  Muted(j.dropoff != null ? 'Deliver to ${j.dropoff!.displayName}' : 'Delivery point to be arranged'),
                  Muted('Dala: ${j.needs.join(', ')}'),
                ]),
              ),
          ],
        ),
      ),
    );
  }
}

class _AcceptSheet extends StatefulWidget {
  const _AcceptSheet({required this.job, required this.profile});
  final HaulJob job;
  final HaulerProfile profile;
  @override
  State<_AcceptSheet> createState() => _AcceptSheetState();
}

class _AcceptSheetState extends State<_AcceptSheet> {
  late final _fee = TextEditingController(
    text: widget.profile.ratePerHead == null ? '' : (double.parse(widget.profile.ratePerHead!) * widget.job.heads).round().toString(),
  );
  late DateTime _when = DateTime.parse('${widget.job.pickupOn ?? DateTime.now().add(const Duration(days: 1)).toIso8601String().substring(0, 10)}T06:00:00');
  bool _busy = false;

  @override
  Widget build(BuildContext context) {
    final fee = double.tryParse(_fee.text);
    return Padding(
      padding: EdgeInsets.fromLTRB(16, 16, 16, 16 + MediaQuery.of(context).viewInsets.bottom),
      child: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
        Text('Take this job', style: Theme.of(context).textTheme.titleLarge),
        Muted('${widget.job.heads} ${speciesLabel[widget.job.species]} from ${widget.job.farmName}, ${widget.job.pickup.displayName}'),
        const SizedBox(height: 12),
        TextField(
          controller: _fee,
          keyboardType: TextInputType.number,
          decoration: InputDecoration(labelText: 'Your fee, ₱', helperText: fee == null ? null : '${money((fee / widget.job.heads).toStringAsFixed(2))} per head'),
          onChanged: (_) => setState(() {}),
        ),
        const SizedBox(height: 12),
        InputDecorator(
          decoration: const InputDecoration(labelText: 'Pickup'),
          child: Row(children: [
            Expanded(child: Text(when(_when.toIso8601String()))),
            TextButton(
              onPressed: () async {
                final d = await showDatePicker(context: context, firstDate: DateTime.now().subtract(const Duration(days: 1)), lastDate: DateTime.now().add(const Duration(days: 60)), initialDate: _when);
                if (d == null || !context.mounted) return;
                final t = await showTimePicker(context: context, initialTime: TimeOfDay.fromDateTime(_when));
                if (t != null) setState(() => _when = DateTime(d.year, d.month, d.day, t.hour, t.minute));
              },
              child: const Text('change'),
            ),
          ]),
        ),
        const SizedBox(height: 12),
        const Muted('Bring the LGU shipping permit and the veterinary health certificate. The trip cannot start without their numbers, the head count and a photo of the load.'),
        const SizedBox(height: 12),
        FilledButton(
          onPressed: _busy || fee == null || fee <= 0
              ? null
              : () async {
                  setState(() => _busy = true);
                  try {
                    final s = await Api.acceptHaulJob(widget.job.dealId, fee.toStringAsFixed(2), _when.toUtc().toIso8601String());
                    if (context.mounted) Navigator.pop(context, s.id);
                  } catch (e) {
                    if (context.mounted) showError(context, e);
                  } finally {
                    if (mounted) setState(() => _busy = false);
                  }
                },
          child: Text(_busy ? 'Taking…' : 'Take this job'),
        ),
      ]),
    );
  }
}

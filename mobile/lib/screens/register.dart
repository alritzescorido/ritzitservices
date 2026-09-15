import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';

import '../api/api.dart';
import '../api/client.dart';
import '../api/models.dart';
import '../ui.dart';
import 'widgets/location_picker.dart';

/// Wireframe RegisterFarmer: name, language, farm with barangay, documents.
/// Phase 1 is the farmer app, so the role is fixed; buyers and haulers
/// register through the web app for now.
class RegisterScreen extends StatefulWidget {
  const RegisterScreen({super.key, required this.user, required this.onDone});
  final User user;
  final Future<void> Function() onDone;
  @override
  State<RegisterScreen> createState() => _RegisterScreenState();
}

class _RegisterScreenState extends State<RegisterScreen> {
  late final _name = TextEditingController(text: widget.user.fullName);
  final _farm = TextEditingController();
  String _lang = 'fil';
  String _farmType = 'backyard';
  Location? _barangay;
  XFile? _clearance;
  XFile? _govId;
  bool _busy = false;

  Future<void> _pick(void Function(XFile?) set) async {
    final f = await ImagePicker().pickImage(source: ImageSource.camera, maxWidth: 1600, imageQuality: 85);
    if (f != null) setState(() => set(f));
  }

  Future<String> _uploadDoc(XFile f) async => ApiClient.instance.upload('user_document', await f.readAsBytes(), 'image/jpeg');

  Future<void> _submit() async {
    final b = _barangay;
    if (b == null) return;
    setState(() => _busy = true);
    try {
      await Api.updateMe(fullName: _name.text.trim(), lang: _lang);
      if (!widget.user.isFarmer) {
        await Api.addRole('farmer');
        // The API reads roles from the token's claims, not the database, so the
        // token must be rotated before POST /farms, which requires the farmer role.
        await ApiClient.instance.refresh();
      }
      await Api.createFarm(_farm.text.trim().isEmpty ? '${_name.text.trim()} farm' : _farm.text.trim(), b.code, _farmType);
      if (_clearance != null) await Api.registerDocument('barangay_clearance', await _uploadDoc(_clearance!));
      if (_govId != null) await Api.registerDocument('gov_id', await _uploadDoc(_govId!));
      await widget.onDone();
    } catch (e) {
      if (mounted) showError(context, e);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Tell us who you are')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          const Muted('Verification usually takes 2 working days. You can see prices right away.'),
          const SizedBox(height: 14),
          TextField(controller: _name, decoration: const InputDecoration(labelText: 'Full name (as on your ID)'), autofillHints: const [AutofillHints.name]),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _lang,
            decoration: const InputDecoration(labelText: 'Language'),
            items: const [
              DropdownMenuItem(value: 'fil', child: Text('Filipino')),
              DropdownMenuItem(value: 'en', child: Text('English')),
              DropdownMenuItem(value: 'ilo', child: Text('Ilokano')),
              DropdownMenuItem(value: 'ceb', child: Text('Cebuano')),
              DropdownMenuItem(value: 'hil', child: Text('Hiligaynon')),
            ],
            onChanged: (v) => setState(() => _lang = v ?? 'fil'),
          ),
          const SectionTitle('Your farm'),
          TextField(controller: _farm, decoration: const InputDecoration(labelText: 'Farm name', hintText: 'e.g. Maligaya backyard')),
          const SizedBox(height: 12),
          LocationPicker(level: 'barangay', label: 'Barangay', value: _barangay, onChanged: (l) => setState(() => _barangay = l)),
          const SizedBox(height: 12),
          DropdownButtonFormField<String>(
            initialValue: _farmType,
            decoration: const InputDecoration(labelText: 'Type'),
            items: const [
              DropdownMenuItem(value: 'backyard', child: Text('Backyard')),
              DropdownMenuItem(value: 'commercial', child: Text('Commercial')),
              DropdownMenuItem(value: 'cooperative', child: Text('Cooperative')),
            ],
            onChanged: (v) => setState(() => _farmType = v ?? 'backyard'),
          ),
          const SectionTitle('Documents'),
          _docRow('Barangay clearance (required for verification)', _clearance, () => _pick((f) => _clearance = f)),
          _docRow('Government ID (optional)', _govId, () => _pick((f) => _govId = f)),
          const SizedBox(height: 8),
          const Muted('You can add documents later under Ako, but verification starts only when the clearance is in.'),
          const SizedBox(height: 16),
          FilledButton(onPressed: _busy || _name.text.trim().length < 2 || _barangay == null ? null : _submit, child: Text(_busy ? 'Saving…' : 'Finish')),
        ],
      ),
    );
  }

  Widget _docRow(String label, XFile? file, VoidCallback onPick) => ListTile(
        contentPadding: EdgeInsets.zero,
        title: Text(label, style: const TextStyle(fontSize: 14)),
        subtitle: file == null ? null : Muted(file.name),
        trailing: OutlinedButton.icon(onPressed: onPick, icon: const Icon(Icons.photo_camera_outlined), label: Text(file == null ? 'Photo' : 'Retake')),
      );
}

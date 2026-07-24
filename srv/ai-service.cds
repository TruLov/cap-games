/**
 * Platform AI service — internal (@protocol:'none'), consumed in-process via
 * cds.connect.to('AiService'). Games just require this service and call chat();
 * WHICH backend answers (mock vs real AI Core) is a platform/profile decision
 * (cds.requires.ai.kind), never the game's concern.
 */
@protocol: 'none'
service AiService {
  // messages/options are JSON strings — chat payloads are free-form.
  action chat(messages: LargeString, options: LargeString) returns LargeString;
}

# M5 验收：admin API + 快照 + lore + NPC profiles
$ErrorActionPreference = 'Stop'
$api = 'http://127.0.0.1:3000/api'
$json = 'application/json; charset=utf-8'
$admin = @{ Authorization = 'Bearer dev-admin-key' }
$adminJson = @{ Authorization = 'Bearer dev-admin-key'; 'Content-Type' = 'application/json; charset=utf-8' }

function Post-Admin($uri, $body) {
  $b = if ($body) { $body | ConvertTo-Json -Depth 5 } else { '{}' }
  Invoke-RestMethod -Method Post -Uri $uri -Headers $adminJson -Body $b
}
function Put-Admin($uri, $body) {
  Invoke-RestMethod -Method Put -Uri $uri -Headers $adminJson -Body ($body | ConvertTo-Json -Depth 5)
}
function Get-Admin($uri) { Invoke-RestMethod -Method Get -Uri $uri -Headers $admin }
function Delete-Admin($uri) { Invoke-RestMethod -Method Delete -Uri $uri -Headers $admin -ErrorAction Stop }
function Patch-Admin($uri, $body) {
  Invoke-RestMethod -Method Patch -Uri $uri -Headers $adminJson -Body ($body | ConvertTo-Json -Depth 5)
}
function Get-StatusCode($scriptBlock) { try { & $scriptBlock | Out-Null; 200 } catch { [int]$_.Exception.Response.StatusCode } }

$pass = 0; $fail = 0
function Assert($name, $cond) {
  if ($cond) { $script:pass++; Write-Output "PASS  $name" } else { $script:fail++; Write-Output "FAIL  $name" }
}

# --- Setup ---
Post-Admin "$api/admin/worlds/modern-earth/activate" @{} | Out-Null
$alice = (Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType $json -Body '{"handle":"alice","password":"secret123"}')
$aliceId = $alice.user.id

# === Admin Posts ===
Write-Output "`n--- Admin Posts ---"
$post1 = Post-Admin "$api/admin/posts" @{ authorId = $aliceId; content = 'M5 test post' }
Assert "admin create post returns id" ($post1.id -gt 0)

$post2 = Post-Admin "$api/admin/posts" @{ authorId = $aliceId; content = 'backdated post'; createdAt = 1000000000000 }
Assert "admin create post with custom timestamp" ($post2.id -gt 0)

Assert "admin create post - missing user 404" ((Get-StatusCode { Post-Admin "$api/admin/posts" @{ authorId = 99999; content = 'x' } }) -eq 404)

# === Admin Counts ===
Write-Output "`n--- Admin Counts ---"
Post-Admin "$api/admin/posts/$($post1.id)/counts" @{ likeCount = 10; viewCount = 100 } | Out-Null
Assert "count injection succeeds" ($true)

# === Admin Follows ===
Write-Output "`n--- Admin Follows ---"
$bob = (Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType $json -Body '{"handle":"bob","password":"secret123"}')
$bobId = $bob.user.id
$result = Post-Admin "$api/admin/follows" @{ pairs = @(@{ followerId = $bobId; followeeId = $aliceId }) }
Assert "bulk follow returns created count" ($result.created -ge 0)

# === Admin Import ===
Write-Output "`n--- Admin Import ---"
$import = Post-Admin "$api/admin/import" @{
  posts = @(@{ authorId = $aliceId; content = 'imported post 1' }, @{ authorId = $aliceId; content = 'imported post 2' })
}
Assert "bulk import creates posts" ($import.postsCreated -eq 2)

# === Admin Users ===
Write-Output "`n--- Admin Users ---"
$users = Get-Admin "$api/admin/users"
Assert "admin users list is non-empty" (@($users.users).Count -gt 0)

# === Clock Control ===
Write-Output "`n--- Clock Control ---"
$clock = Post-Admin "$api/admin/worlds/clock" @{ type = 'pause' }
Assert "clock pause" ($clock.clock.paused -eq $true)

$clock = Post-Admin "$api/admin/worlds/clock" @{ type = 'resume' }
Assert "clock resume" ($clock.clock.paused -eq $false)

$clock = Post-Admin "$api/admin/worlds/clock" @{ type = 'setScale'; scale = 10 }
Assert "clock setScale" ($clock.clock.scale -eq 10)

Post-Admin "$api/admin/worlds/clock" @{ type = 'setScale'; scale = 1 } | Out-Null

# === World Meta Update ===
Write-Output "`n--- World Meta ---"
$updated = Patch-Admin "$api/admin/worlds/modern-earth" @{ description = 'M5 test description' }
Assert "world meta PATCH" ($updated.world.description -eq 'M5 test description')

# === Lore ===
Write-Output "`n--- Lore ---"
Put-Admin "$api/admin/lore/test-lore.md" @{ content = "# Test Lore`n`nThis is a test lore file." } | Out-Null
$loreList = Get-Admin "$api/admin/lore"
Assert "lore file created and listed" (@($loreList.files).Count -gt 0)

$loreContent = Get-Admin "$api/admin/lore/test-lore.md"
Assert "lore file readable" ($loreContent.content -like '*Test Lore*')

Delete-Admin "$api/admin/lore/test-lore.md"
$loreAfter = Get-Admin "$api/admin/lore"
$testExists = @($loreAfter.files) | Where-Object { $_.filename -eq 'test-lore.md' }
Assert "lore file deleted" ($testExists.Count -eq 0)

# === NPC Profiles ===
Write-Output "`n--- NPC Profiles ---"
$npc = Put-Admin "$api/admin/npc-profiles/$aliceId" @{ tier = 'core'; interests = @('tech','music'); personality = 'cheerful' }
Assert "npc profile created" ($npc.tier -eq 'core')

$npcList = Get-Admin "$api/admin/npc-profiles"
Assert "npc profile listed" (@($npcList.profiles).Count -gt 0)

$npcGet = Get-Admin "$api/admin/npc-profiles/$aliceId"
Assert "npc profile get by id" ($npcGet.personality -eq 'cheerful')

Delete-Admin "$api/admin/npc-profiles/$aliceId"
Assert "npc profile deleted" ((Get-StatusCode { Get-Admin "$api/admin/npc-profiles/$aliceId" }) -eq 404)

# === Snapshots ===
Write-Output "`n--- Snapshots ---"
try { Delete-Admin "$api/admin/worlds/modern-earth/snapshots/test-snap" } catch {}
$snap = Post-Admin "$api/admin/worlds/snapshots" @{ name = 'test-snap'; description = 'M5 test' }
Assert "snapshot created" ($snap.name -eq 'test-snap')

$snapList = Get-Admin "$api/admin/worlds/modern-earth/snapshots"
Assert "snapshot listed" (@($snapList.snapshots).Count -gt 0)

# Create a post after snapshot
$postAfterSnap = Post-Admin "$api/admin/posts" @{ authorId = $aliceId; content = 'post after snapshot' }

# Restore snapshot
Post-Admin "$api/admin/worlds/modern-earth/snapshots/test-snap/restore" | Out-Null
Assert "snapshot restored" ($true)

# Verify post-after-snapshot is gone (new login needed after restore)
$aliceNew = (Invoke-RestMethod -Method Post -Uri "$api/auth/login" -ContentType $json -Body '{"handle":"alice","password":"secret123"}')
$aliceAuth = @{ Authorization = "Bearer $($aliceNew.token)" }
$checkPost = Get-StatusCode { Invoke-RestMethod "$api/posts/$($postAfterSnap.id)" -Headers $aliceAuth }
Assert "post after snapshot is gone after restore" ($checkPost -eq 404)

# Delete snapshot
Delete-Admin "$api/admin/worlds/modern-earth/snapshots/test-snap"
$snapAfter = Get-Admin "$api/admin/worlds/modern-earth/snapshots"
$testSnapExists = @($snapAfter.snapshots) | Where-Object { $_.name -eq 'test-snap' }
Assert "snapshot deleted" ($testSnapExists.Count -eq 0)

# === Topics ===
Write-Output "`n--- Topics ---"
$topic = Post-Admin "$api/admin/topics" @{ title = 'Test Topic'; description = 'A test'; heat = 0.7; tags = @('tech','gaming') }
Assert "topic created" ($topic.id -gt 0)
Assert "topic stage is emerging" ($topic.stage -eq 'emerging')
Assert "topic heat" ($topic.heat -eq 0.7)

$topicList = Get-Admin "$api/admin/topics"
Assert "topic listed" (@($topicList.topics).Count -gt 0)

$updated = Patch-Admin "$api/admin/topics/$($topic.id)" @{ stage = 'peak'; heat = 1.0 }
Assert "topic updated to peak" ($updated.stage -eq 'peak')

Delete-Admin "$api/admin/topics/$($topic.id)"
$afterDelete = Get-Admin "$api/admin/topics"
$exists = @($afterDelete.topics) | Where-Object { $_.id -eq $topic.id }
Assert "topic deleted" ($exists.Count -eq 0)

# === Content Pools ===
Write-Output "`n--- Content Pools ---"
Post-Admin "$api/admin/content-pools" @{ poolType = 'scene'; key = 'test-scene'; items = @('hello','world','test') } | Out-Null
$pools = Get-Admin "$api/admin/content-pools"
Assert "scene pool created" ($pools.scenePools.'test-scene'.Count -eq 3)

Post-Admin "$api/admin/content-pools" @{ poolType = 'topic'; key = 'test-topic'; items = @('topic item 1','topic item 2') } | Out-Null
$pools2 = Get-Admin "$api/admin/content-pools"
Assert "topic pool created" ($pools2.topicPools.'test-topic'.Count -eq 2)

Delete-Admin "$api/admin/content-pools/scene/test-scene"
Delete-Admin "$api/admin/content-pools/topic/test-topic"
$pools3 = Get-Admin "$api/admin/content-pools"
Assert "pools cleared" ($null -eq $pools3.scenePools.'test-scene')

# === No-auth guard ===
Write-Output "`n--- Auth Guard ---"
Assert "admin API rejects no auth" ((Get-StatusCode { Invoke-RestMethod "$api/admin/posts" -Method Post -ContentType $json -Body '{"authorId":1,"content":"x"}' }) -eq 401)
Assert "admin API rejects bad key" ((Get-StatusCode { Invoke-RestMethod "$api/admin/posts" -Method Post -ContentType $json -Headers @{ Authorization = 'Bearer wrong-key' } -Body '{"authorId":1,"content":"x"}' }) -eq 401)

# === Simulator Status ===
Write-Output "`n--- Simulator Status ---"
$simStatus = Invoke-RestMethod "$api/simulator/status"
Assert "simulator status endpoint" ($null -ne $simStatus)

# === Summary ===
Write-Output "`n=========================================="
Write-Output "M5 Admin API: $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 }

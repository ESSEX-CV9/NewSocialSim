# DM 验收：会话创建→消息→请求态→已读→回应→删除→屏蔽→隐藏→媒体互斥（需后端已启动）
$ErrorActionPreference = 'Stop'
$api = 'http://127.0.0.1:3000/api'
$json = 'application/json; charset=utf-8'

function Post-Json($uri, $body, $headers = @{}) {
  Invoke-RestMethod -Method Post -Uri $uri -ContentType $json -Headers $headers -Body ($body | ConvertTo-Json -Depth 5)
}
function Put-Json($uri, $body, $headers = @{}) {
  Invoke-RestMethod -Method Put -Uri $uri -ContentType $json -Headers $headers -Body ($body | ConvertTo-Json -Depth 5)
}
function Get-StatusCode($scriptBlock) { try { & $scriptBlock | Out-Null; 200 } catch { [int]$_.Exception.Response.StatusCode } }
$pass = 0; $fail = 0
function Assert($name, $cond) {
  if ($cond) { $script:pass++; Write-Output "PASS  $name" } else { $script:fail++; Write-Output "FAIL  $name" }
}

# 确保在现代地球
Post-Json "$api/admin/worlds/modern-earth/activate" @{} | Out-Null

# 注册四个一次性测试用户（随机后缀，可重复运行）：
# u1 发起方；u2 不关注 u1（请求态流）；u3 关注 u1（直进收件箱）；u4 隐式接受与屏蔽测试
$sfx = -join ((97..122) | Get-Random -Count 6 | ForEach-Object { [char]$_ })
$h1 = "dmva$sfx"; $h2 = "dmvb$sfx"; $h3 = "dmvc$sfx"; $h4 = "dmvd$sfx"
$tok = @{}
foreach ($h in @($h1, $h2, $h3, $h4)) {
  $r = Post-Json "$api/auth/register" @{ handle = $h; displayName = "DM Tester $h"; password = 'secret123' }
  $tok[$h] = @{ Authorization = "Bearer $($r.token)" }
}
$u1 = $tok[$h1]; $u2 = $tok[$h2]; $u3 = $tok[$h3]; $u4 = $tok[$h4]
$uid = @{}
foreach ($h in @($h1, $h2, $h3, $h4)) { $uid[$h] = (Invoke-RestMethod "$api/users/$h").user.id }

# u3 关注 u1
Post-Json "$api/users/$h1/follow" @{} $u3 | Out-Null

# --- 会话创建 ---
$c12 = (Post-Json "$api/messages/conversations" @{ userId = $uid[$h2] } $u1).conversation
Assert "建会话成功且对方正确" ($c12.otherParticipant.handle -eq $h2)
Assert "新会话无消息" ($null -eq $c12.lastMessage)
Assert "find-or-create 幂等(同 id)" ((Post-Json "$api/messages/conversations" @{ userId = $uid[$h2] } $u1).conversation.id -eq $c12.id)
Assert "对方视角同一会话(dm_key)" ((Post-Json "$api/messages/conversations" @{ userId = $uid[$h1] } $u2).conversation.id -eq $c12.id)
Assert "不能与自己建会话 (400)" ((Get-StatusCode { Post-Json "$api/messages/conversations" @{ userId = $uid[$h1] } $u1 }) -eq 400)
Assert "目标用户不存在 (404)" ((Get-StatusCode { Post-Json "$api/messages/conversations" @{ userId = 99999999 } $u1 }) -eq 404)

# --- 发消息与请求态 ---
$m1 = (Post-Json "$api/messages/conversations/$($c12.id)/messages" @{ content = 'hello from u1' } $u1).message
Assert "发消息成功" ($m1.content -eq 'hello from u1' -and $m1.sender.handle -eq $h1)
Assert "空消息 (400)" ((Get-StatusCode { Post-Json "$api/messages/conversations/$($c12.id)/messages" @{ content = '   ' } $u1 }) -eq 400)
$inbox2 = (Invoke-RestMethod "$api/messages/conversations?filter=inbox" -Headers $u2).items
$req2 = (Invoke-RestMethod "$api/messages/conversations?filter=requests" -Headers $u2).items
Assert "陌生人来信不进收件箱" (@($inbox2).Count -eq 0)
Assert "陌生人来信进请求箱" (@($req2).Count -eq 1 -and $req2[0].state -eq 'request')
Assert "请求箱条目未读数为 1" ($req2[0].unreadCount -eq 1)
$uc2 = Invoke-RestMethod "$api/messages/unread-count" -Headers $u2
Assert "u2 角标 count=0 requestCount=1" ($uc2.count -eq 0 -and $uc2.requestCount -eq 1)
Assert "发起方自己在收件箱" ((Invoke-RestMethod "$api/messages/conversations" -Headers $u1).items[0].id -eq $c12.id)
Assert "发起方无未读(自己发的)" ((Invoke-RestMethod "$api/messages/unread-count" -Headers $u1).count -eq 0)

# u1 -> u3（u3 关注 u1）：直进收件箱
$c13 = (Post-Json "$api/messages/conversations" @{ userId = $uid[$h3] } $u1).conversation
Post-Json "$api/messages/conversations/$($c13.id)/messages" @{ content = 'hi u3' } $u1 | Out-Null
$uc3 = Invoke-RestMethod "$api/messages/unread-count" -Headers $u3
Assert "被关注者来信直进收件箱" ($uc3.count -eq 1 -and $uc3.requestCount -eq 0)

# --- 接受请求 ---
$accepted = (Post-Json "$api/messages/conversations/$($c12.id)/accept" @{} $u2).conversation
Assert "接受请求后 state=inbox" ($accepted.state -eq 'inbox')
Assert "接受后进收件箱列表" (@((Invoke-RestMethod "$api/messages/conversations" -Headers $u2).items).Count -eq 1)
Assert "接受幂等" ((Post-Json "$api/messages/conversations/$($c12.id)/accept" @{} $u2).conversation.state -eq 'inbox')

# --- 已读与 Seen ---
$rd = Post-Json "$api/messages/conversations/$($c12.id)/read" @{} $u2
Assert "标记已读到最新消息" ($rd.lastReadMessageId -eq $m1.id)
Assert "已读后角标清零" ((Invoke-RestMethod "$api/messages/unread-count" -Headers $u2).count -eq 0)
$detail1 = (Invoke-RestMethod "$api/messages/conversations/$($c12.id)" -Headers $u1).conversation
Assert "发送方看到对方已读位置(Seen)" ($detail1.otherLastReadMessageId -eq $m1.id)
$rdOver = Post-Json "$api/messages/conversations/$($c12.id)/read" @{ messageId = 99999999 } $u2
Assert "已读位置钳制到最新消息" ($rdOver.lastReadMessageId -eq $m1.id)

# --- 消息分页（倒序 + 游标）---
foreach ($i in 2..6) {
  Post-Json "$api/messages/conversations/$($c12.id)/messages" @{ content = "msg $i" } $u1 | Out-Null
}
$pg1 = Invoke-RestMethod "$api/messages/conversations/$($c12.id)/messages?limit=3" -Headers $u2
Assert "第一页 3 条且最新在前" (@($pg1.items).Count -eq 3 -and $pg1.items[0].content -eq 'msg 6')
Assert "有下一页游标" ($null -ne $pg1.nextCursor)
$pg2 = Invoke-RestMethod "$api/messages/conversations/$($c12.id)/messages?limit=3&cursor=$($pg1.nextCursor)" -Headers $u2
Assert "第二页接续且 id 严格递减" (@($pg2.items).Count -eq 3 -and $pg2.items[0].id -lt $pg1.items[2].id)
$convPrev = (Invoke-RestMethod "$api/messages/conversations" -Headers $u2).items[0]
Assert "会话列表预览为最后一条" ($convPrev.lastMessage.content -eq 'msg 6')

# --- 隐式接受：u1 -> u4 首条进请求，u4 回复后自动转收件箱 ---
$c14 = (Post-Json "$api/messages/conversations" @{ userId = $uid[$h4] } $u1).conversation
Post-Json "$api/messages/conversations/$($c14.id)/messages" @{ content = 'hi u4' } $u1 | Out-Null
Assert "u4 首条来信在请求箱" ((Invoke-RestMethod "$api/messages/unread-count" -Headers $u4).requestCount -eq 1)
Post-Json "$api/messages/conversations/$($c14.id)/messages" @{ content = 'reply from u4' } $u4 | Out-Null
Assert "回复=隐式接受" ((Invoke-RestMethod "$api/messages/conversations/$($c14.id)" -Headers $u4).conversation.state -eq 'inbox')

# --- 表情回应 ---
$rx1 = (Put-Json "$api/messages/$($m1.id)/reaction" @{ emoji = [char]::ConvertFromUtf32(0x1F44D) } $u2).reactions
Assert "添加回应成功" (@($rx1).Count -eq 1 -and $rx1[0].userId -eq $uid[$h2])
$rx2 = (Put-Json "$api/messages/$($m1.id)/reaction" @{ emoji = [char]::ConvertFromUtf32(0x1F602) } $u2).reactions
Assert "换表情=覆盖(仍 1 条)" (@($rx2).Count -eq 1 -and $rx2[0].emoji -ne $rx1[0].emoji)
Assert "非法表情 (400)" ((Get-StatusCode { Put-Json "$api/messages/$($m1.id)/reaction" @{ emoji = 'xx' } $u2 }) -eq 400)
$rx3 = (Invoke-RestMethod -Method Delete -Uri "$api/messages/$($m1.id)/reaction" -Headers $u2).reactions
Assert "撤销回应" (@($rx3).Count -eq 0)
Assert "撤销幂等" (@((Invoke-RestMethod -Method Delete -Uri "$api/messages/$($m1.id)/reaction" -Headers $u2).reactions).Count -eq 0)

# --- 消息删除 ---
Assert "不能删别人的消息 (403)" ((Get-StatusCode { Invoke-RestMethod -Method Delete -Uri "$api/messages/$($m1.id)" -Headers $u2 }) -eq 403)
$del = (Invoke-RestMethod -Method Delete -Uri "$api/messages/$($m1.id)" -Headers $u1).message
Assert "软删除成墓碑" ($del.deleted -eq $true -and $del.content -eq '')
$tomb = (Invoke-RestMethod "$api/messages/conversations/$($c12.id)/messages?limit=50" -Headers $u2).items | Where-Object { $_.id -eq $m1.id }
Assert "对方视角也是墓碑" ($tomb.deleted -eq $true -and $tomb.content -eq '')
Assert "墓碑不能回应 (400)" ((Get-StatusCode { Put-Json "$api/messages/$($m1.id)/reaction" @{ emoji = [char]::ConvertFromUtf32(0x1F44D) } $u2 }) -eq 400)

# --- 非参与者隔离 ---
Assert "非参与者查会话 (404)" ((Get-StatusCode { Invoke-RestMethod "$api/messages/conversations/$($c12.id)" -Headers $u3 }) -eq 404)
Assert "非参与者查消息 (404)" ((Get-StatusCode { Invoke-RestMethod "$api/messages/conversations/$($c12.id)/messages" -Headers $u3 }) -eq 404)
Assert "非参与者发消息 (404)" ((Get-StatusCode { Post-Json "$api/messages/conversations/$($c12.id)/messages" @{ content = 'x' } $u3 }) -eq 404)

# --- 屏蔽 ---
Post-Json "$api/users/$h1/block" @{} $u4 | Out-Null
Assert "被屏蔽后发消息 (403)" ((Get-StatusCode { Post-Json "$api/messages/conversations/$($c14.id)/messages" @{ content = 'blocked?' } $u1 }) -eq 403)
Assert "屏蔽者也不能发 (403)" ((Get-StatusCode { Post-Json "$api/messages/conversations/$($c14.id)/messages" @{ content = 'me too' } $u4 }) -eq 403)
Assert "被屏蔽后建会话 (403)" ((Get-StatusCode { Post-Json "$api/messages/conversations" @{ userId = $uid[$h4] } $u1 }) -eq 403)
Assert "详情 blockedEither=true" ((Invoke-RestMethod "$api/messages/conversations/$($c14.id)" -Headers $u1).conversation.blockedEither -eq $true)
Invoke-RestMethod -Method Delete -Uri "$api/users/$h1/block" -Headers $u4 | Out-Null
Assert "解除屏蔽后可再发" ((Get-StatusCode { Post-Json "$api/messages/conversations/$($c14.id)/messages" @{ content = 'unblocked' } $u1 }) -eq 200)

# --- 隐藏会话与重现 ---
Invoke-RestMethod -Method Delete -Uri "$api/messages/conversations/$($c12.id)" -Headers $u2 | Out-Null
Assert "删除会话后列表为空" (@((Invoke-RestMethod "$api/messages/conversations" -Headers $u2).items).Count -eq 0)
Post-Json "$api/messages/conversations/$($c12.id)/messages" @{ content = 'are you there' } $u1 | Out-Null
Assert "对方再发消息会话重现" (@((Invoke-RestMethod "$api/messages/conversations" -Headers $u2).items).Count -eq 1)

# --- 媒体：发图与互斥占用 ---
$pngPath = Join-Path $env:TEMP 'dm-verify-1px.png'
[System.IO.File]::WriteAllBytes($pngPath, [Convert]::FromBase64String('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='))
$auth1 = $u1.Authorization
$med1 = (curl.exe -s -X POST "$api/media/upload" -H "Authorization: $auth1" -F "file=@$pngPath;type=image/png" | ConvertFrom-Json).media
$med2 = (curl.exe -s -X POST "$api/media/upload" -H "Authorization: $auth1" -F "file=@$pngPath;type=image/png" | ConvertFrom-Json).media
$mMsg = (Post-Json "$api/messages/conversations/$($c12.id)/messages" @{ content = ''; mediaIds = @($med1.id) } $u1).message
Assert "纯图消息成功且带媒体" (@($mMsg.media).Count -eq 1 -and $mMsg.media[0].id -eq $med1.id)
Assert "媒体已挂消息不能再用 (400)" ((Get-StatusCode { Post-Json "$api/messages/conversations/$($c12.id)/messages" @{ content = 'again'; mediaIds = @($med1.id) } $u1 }) -eq 400)
$vp = (Post-Json "$api/posts" @{ content = 'dm verify post'; mediaIds = @($med2.id) } $u1).post
Assert "媒体已挂帖子不能发消息 (400)" ((Get-StatusCode { Post-Json "$api/messages/conversations/$($c12.id)/messages" @{ content = 'x'; mediaIds = @($med2.id) } $u1 }) -eq 400)
Assert "别人的媒体不能用 (400)" ((Get-StatusCode { Post-Json "$api/messages/conversations/$($c12.id)/messages" @{ content = 'x'; mediaIds = @($med1.id) } $u2 }) -eq 400)
Remove-Item $pngPath -Force

# 清理：软删测试帖（测试用户与会话保留，不影响他人视图）
Invoke-RestMethod -Method Delete -Uri "$api/posts/$($vp.id)" -Headers $u1 | Out-Null

Write-Output ''
Write-Output "PASS=$pass FAIL=$fail"
if ($fail -gt 0) { exit 1 }

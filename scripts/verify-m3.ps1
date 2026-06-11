# M3 验收：多用户走通 发帖→关注→回复→引用→赞→转发→时间线→通知→搜索→删除
$ErrorActionPreference = 'Stop'
$api = 'http://127.0.0.1:3000/api'
$json = 'application/json; charset=utf-8'

function Post-Json($uri, $body, $headers = @{}) {
  Invoke-RestMethod -Method Post -Uri $uri -ContentType $json -Headers $headers -Body ($body | ConvertTo-Json -Depth 5)
}
function Get-StatusCode($scriptBlock) { try { & $scriptBlock | Out-Null; 200 } catch { [int]$_.Exception.Response.StatusCode } }
$pass = 0; $fail = 0
function Assert($name, $cond) {
  if ($cond) { $script:pass++; Write-Output "PASS  $name" } else { $script:fail++; Write-Output "FAIL  $name" }
}

# 确保在现代地球
Post-Json "$api/admin/worlds/modern-earth/activate" @{} | Out-Null

# 注册 bob 和 carol（alice 在 M2 已存在）
foreach ($u in @(@{h='bob'; n='鲍勃'}, @{h='carol'; n='卡罗尔'})) {
  try { Post-Json "$api/auth/register" @{ handle=$u.h; displayName=$u.n; password='secret123' } | Out-Null } catch {}
}
$alice = @{ Authorization = "Bearer $((Post-Json "$api/auth/login" @{handle='alice'; password='secret123'}).token)" }
$bob   = @{ Authorization = "Bearer $((Post-Json "$api/auth/login" @{handle='bob';   password='secret123'}).token)" }
$carol = @{ Authorization = "Bearer $((Post-Json "$api/auth/login" @{handle='carol'; password='secret123'}).token)" }

# 关注：bob、carol 关注 alice；bob 关注 carol
Post-Json "$api/users/alice/follow" @{} $bob   | Out-Null
Post-Json "$api/users/alice/follow" @{} $carol | Out-Null
Post-Json "$api/users/carol/follow" @{} $bob   | Out-Null
Assert "alice 有 2 个粉丝" ((Invoke-RestMethod "$api/users/alice").user.followerCount -eq 2)
Assert "不能关注自己 (400)" ((Get-StatusCode { Post-Json "$api/users/bob/follow" @{} $bob }) -eq 400)

# alice 发帖
$p1 = (Post-Json "$api/posts" @{ content='大家好，这是现代地球的第一条帖子！#你好世界' } $alice).post
Assert "发帖成功，作者是 alice" ($p1.author.handle -eq 'alice')

# bob 回复
$r1 = (Post-Json "$api/posts" @{ content='沙发！欢迎来到新世界'; replyToId=$p1.id } $bob).post
Assert "回复的 replyToId 正确" ($r1.replyToId -eq $p1.id)
Assert "原帖回复数 +1" ((Invoke-RestMethod "$api/posts/$($p1.id)").post.replyCount -eq 1)

# carol 引用
$q1 = (Post-Json "$api/posts" @{ content='看看这个历史性时刻'; quoteOfId=$p1.id } $carol).post
Assert "引用帖嵌入了原帖" ($q1.quoted.id -eq $p1.id)
Assert "回复+引用同时给 (400)" ((Get-StatusCode { Post-Json "$api/posts" @{ content='x'; replyToId=$p1.id; quoteOfId=$p1.id } $bob }) -eq 400)

# 赞与转发
Post-Json "$api/posts/$($p1.id)/like" @{} $bob | Out-Null
Post-Json "$api/posts/$($p1.id)/like" @{} $carol | Out-Null
Post-Json "$api/posts/$($p1.id)/like" @{} $carol | Out-Null   # 重复赞，应幂等
$rp = Post-Json "$api/posts/$($p1.id)/repost" @{} $bob
$p1v = (Invoke-RestMethod "$api/posts/$($p1.id)" -Headers $bob).post
Assert "赞数为 2（幂等）" ($p1v.likeCount -eq 2)
Assert "转发数为 1" ($p1v.repostCount -eq 1)
Assert "bob 视角 likedByViewer=true" ($p1v.likedByViewer -eq $true)
$un = Invoke-RestMethod -Method Delete -Uri "$api/posts/$($p1.id)/like" -Headers $carol
Assert "取消赞后数量为 1" ($un.count -eq 1)

# 时间线：bob 的关注流应包含 alice 的帖子和 carol 的引用帖；自己转发的条目
$homeTl = (Invoke-RestMethod "$api/timeline/home" -Headers $bob).items
Assert "bob 关注流含 alice 原帖" (@($homeTl | Where-Object { $_.post.id -eq $p1.id -and $_.type -eq 'post' }).Count -ge 1)
Assert "bob 关注流含 carol 引用帖" (@($homeTl | Where-Object { $_.post.id -eq $q1.id }).Count -ge 1)
Assert "bob 关注流含转发条目(带转发者)" (@($homeTl | Where-Object { $_.type -eq 'repost' -and $_.repostedBy.handle -eq 'bob' }).Count -ge 1)
Assert "关注流不含回复" (@($homeTl | Where-Object { $_.post.id -eq $r1.id }).Count -eq 0)
$global = (Invoke-RestMethod "$api/timeline/global").items
Assert "全站流(匿名)可访问且含帖子" ($global.Count -ge 2)

# 回复列表
$replies = (Invoke-RestMethod "$api/posts/$($p1.id)/replies").items
Assert "回复列表含 bob 的回复" (@($replies | Where-Object { $_.id -eq $r1.id }).Count -eq 1)

# 通知：alice 应收到 回复/引用/赞/转发/关注
Start-Sleep -Milliseconds 200
$notif = (Invoke-RestMethod "$api/notifications" -Headers $alice).items
$types = $notif | ForEach-Object { $_.type } | Sort-Object -Unique
Assert "alice 收到 5 类通知" (($types -join ',') -eq 'follow,like,quote,reply,repost')
$unread = (Invoke-RestMethod "$api/notifications/unread-count" -Headers $alice).count
Assert "未读数 > 0" ($unread -gt 0)
Invoke-RestMethod -Method Post -Uri "$api/notifications/read-all" -Headers $alice -ContentType $json -Body '{}' | Out-Null
Assert "全部已读后未读数为 0" ((Invoke-RestMethod "$api/notifications/unread-count" -Headers $alice).count -eq 0)

# 搜索
$sp = (Invoke-RestMethod "$api/search/posts?q=$([uri]::EscapeDataString('你好世界'))").items
Assert "搜索帖子命中话题标签" (@($sp | Where-Object { $_.id -eq $p1.id }).Count -eq 1)
$su = (Invoke-RestMethod "$api/search/users?q=carol").items
Assert "搜索用户命中 carol" (@($su | Where-Object { $_.handle -eq 'carol' }).Count -eq 1)

# 删除：bob 不能删 alice 的帖子；alice 自删后变墓碑
Assert "删别人的帖子 (403)" ((Get-StatusCode { Invoke-RestMethod -Method Delete -Uri "$api/posts/$($p1.id)" -Headers $bob }) -eq 403)
$p2 = (Post-Json "$api/posts" @{ content='这条马上删掉' } $alice).post
Invoke-RestMethod -Method Delete -Uri "$api/posts/$($p2.id)" -Headers $alice | Out-Null
$tomb = (Invoke-RestMethod "$api/posts/$($p2.id)").post
Assert "删除后为墓碑(deleted=true,内容清空)" ($tomb.deleted -eq $true -and $tomb.content -eq '')
$global2 = (Invoke-RestMethod "$api/timeline/global").items
Assert "墓碑不出现在全站流" (@($global2 | Where-Object { $_.post.id -eq $p2.id }).Count -eq 0)

# 用户帖子列表与分页游标
$ap = Invoke-RestMethod "$api/users/alice/posts?limit=1"
Assert "用户帖子列表分页有 nextCursor 或单页" ($ap.items.Count -le 1)

Write-Output ""
Write-Output "RESULT: $pass passed, $fail failed"

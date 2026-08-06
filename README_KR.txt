응애공주 POPCAT 스타일 클릭커 - 새 사이트용

1. GitHub 새 저장소 만들기
- GitHub에서 New repository를 누릅니다.
- 저장소 이름 예: eungae-princess-clicker
- Public 또는 Private 중 원하는 것을 선택합니다.
- README 자동 생성은 꺼도 됩니다.

2. 업로드할 구조
저장소 첫 화면에서 다음 파일이 바로 보여야 합니다.

server.js
package.json
render.yaml
.env.example
README_KR.txt
index.txt
app.txt
style.txt
public/
  index.html
  app.js
  style.css
  assets/
    idle.png
    pressed.png
    motions/
      1000.png
      10000.png
      100000.png
      1000000.png
      10000000.png
      100000000.png
      1000000000.png
      10000000000.png

ZIP 바깥 폴더 자체를 저장소 안에 한 단계 더 넣지 마세요.

3. Supabase 새 프로젝트
- Supabase에서 New project 생성
- Database password를 안전하게 보관
- Connect 버튼에서 Session pooler 또는 Transaction pooler 연결 문자열 복사
- [YOUR-PASSWORD] 부분을 실제 DB 비밀번호로 바꿉니다.
- 비밀번호에 @, :, /, # 같은 문자가 있으면 URL 인코딩해야 합니다.
- 서버 시작 시 users 테이블과 필요한 컬럼은 자동 생성됩니다.

4. Render 새 Web Service
- Render Dashboard > New > Web Service
- 새 GitHub 저장소 연결
- Branch: main
- Root Directory: 빈칸
- Build Command: npm install
- Start Command: npm start

5. Render Environment Variables
DATABASE_URL = Supabase PostgreSQL 연결 문자열
JWT_SECRET = 32자 이상 긴 임의 문자열
NODE_ENV = production

6. 배포
- Create Web Service 또는 Deploy 클릭
- 로그에 "응애공주 서버 실행"이 표시되면 성공
- GitHub에 새 커밋을 올리면 Render가 자동 재배포

7. 화면/기능
- 이미지가 전체 화면 배경처럼 보이고 화면 전체가 클릭 영역입니다.
- 누적 점수는 상단 중앙에 표시됩니다.
- 실시간 순위는 1~3위만 표시됩니다.
- 모션 설정에서 랜덤 또는 한 개 고정을 선택할 수 있습니다.
- 계정 설정은 Supabase에 저장됩니다.

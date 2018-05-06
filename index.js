const consoleReadLine = (prompt = "") => {
  return new Promise(ok => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false
    });
    rl.setPrompt(prompt);
    rl.prompt();
    rl.once('line', (cmd) => {
      ok(cmd);
      rl.close();
    });
  });
}
const cp = (cmd) => { return require("child_process").execFileSync(cmd, { shell: true }).toString() };
const cs = {
  bold: '\u001b[1m',
  black: '\u001b[30m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
  white: '\u001b[37m',
  reset: '\u001b[0m'
};
const assert = require("assert");
const AWSSDK = require('aws-sdk');
const awsSdkEc2 = new AWSSDK.EC2({
  credentials: new AWSSDK.SharedIniFileCredentials({ profile: "default" }),
  region: "ap-northeast-1"
});
async function getEc2KeyPairs() {
  const r = cp(`aws ec2 describe-key-pairs`);
  const v = JSON.parse(r);
  if (v.KeyPairs.length == 0) {
    console.error(`${cs.bold + cs.red}ec2のキーペアをWebUIから作成して下さい${cs.reset}`);
    process.exit(1);
  }
  v.KeyPairs.forEach((v, i) => {
    console.log(`  [${i + 1}]:${v.KeyName} ${cs.black}${v.KeyFingerprint}${cs.reset}`);
  });
  if (v.KeyPairs.length == 1) {
    await consoleReadLine(`Enterを入力して下さい>`);
    return v.KeyPairs[0].KeyName;
  }
  while (true) {
    const a = Number((await consoleReadLine(`番号=>`)) || "");
    if (0 < a && a <= v.KeyPairs.length) {
      const keyPairId = v.KeyPairs[a - 1].KeyName;
      return keyPairId;
    } else {
      continue;
    }
  }
}
async function getSubnetIdAndVpcId() {
  /*
    VPC:vpc-2f7a2e4a
      subnet[1]:subnet-4dafe414 available ap-northeast-1a [default]
      subnet[2]:subnet-cb7c4ebc available ap-northeast-1c [default]
      subnet[3]:subnet-c05e25e8 available ap-northeast-1d [default]
  */
  const r = cp(`aws ec2 describe-subnets`);
  const v = JSON.parse(r);
  const VPCIdList = v.Subnets.map(a => a.VpcId).filter((value, index, arr) => arr.includes(value) == index).sort();
  let result = [];
  VPCIdList.forEach(vpcId => {
    console.log(`VPC:${vpcId}`);
    v.Subnets.filter(a => a.VpcId == vpcId).sort((a, b) => { return a.AvailabilityZone.localeCompare(b.AvailabilityZone) }).forEach(a => {
      result.push({ subnetId: a.SubnetId, vpcId: vpcId });
      console.log(`  subnet[${result.length}]:${a.SubnetId} ${a.State} ${a.AvailabilityZone} ${a.DefaultForAz ? "[default]" : ""}`);
    });
  });
  while (true) {
    const a = Number((await consoleReadLine(`番号=>`)) || "");
    if (0 < a && a <= result.length) {
      return result[a - 1];
    } else {
      continue;
    }
  }
}
async function getSecurityGroup(vpcId) {
  /*
    ! 指定のVPC以外のセキュリティグループがn件あります。
    [1]:name / tag-name
      description:xxx
      受信許可
        TCP:80(HTTP) 0.0.0.0/0        description
        TCP:80(HTTP) ::/0             description
        TCP:57900    192.168.000.0/32 custom-ssh-port
        sg-1edf7c7a
      送信許可
        全て          0.0.0.0/
  */
  const apiResult = await new Promise((resolve, reject) => {
    awsSdkEc2.describeSecurityGroups({}, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
  const vpcID不一致設定数 = apiResult.SecurityGroups.filter(a => a.VpcId != vpcId).length;
  const vpcID一致設定 = apiResult.SecurityGroups.filter(a => a.VpcId == vpcId);
  if (0 < vpcID不一致設定数) {
    console.log(`! 指定のVPC以外のセキュリティグループが${vpcID不一致設定数}件あります。`)
  }
  const result = [];
  vpcID一致設定.forEach(config => {
    result.push(config.GroupId);
    const tagName = config.Tags.filter(a => a.Key == "Name").map(a => a.Value).join();
    console.log(`[${result.length}]:${config.GroupName} ${tagName != "" ? (" / " + tagName) : ""}`);
    console.log(`  説明文:${config.Description}`);
    const 許可設定解析 = (datas) => {
      const result = [];// {プロトコルとポート:string,ipアドレス:string,説明文:string}
      datas.forEach(data => {
        //console.log(data);
        let プロトコルとポート = "";
        let ipアドレス = "";
        let 説明文 = "";
        if (data.IpProtocol == "-1") {
          プロトコルとポート = `全て`;
          result.push({
            プロトコルとポート: "*",
            ipアドレス: "*",
            説明文: ""
          });
        } else {
          assert.notStrictEqual(data.FromPort, undefined);
          assert.notStrictEqual(data.ToPort, undefined);
          assert.strictEqual(data.ToPort, data.FromPort);
          const type = data.IpProtocol.toUpperCase();
          const portStrList = {
            80: "HTTP",
            22: "SSH"
          };
          const port = data.FromPort;
          const portStr = Object.keys(portStrList).includes(port.toString()) ? portStrList[port] : null;
          if (portStr) {
            プロトコルとポート = `${type}:${port}(${portStr})`;
          } else {
            プロトコルとポート = `${type}:${port}`;
          }
        }
        data.UserIdGroupPairs.forEach(userIdGroupPair => {
          result.push({
            プロトコルとポート: userIdGroupPair.GroupId,
            ipアドレス: "--",
            説明文: userIdGroupPair.Description === undefined ? "" : userIdGroupPair.Description
          });
        })
        data.IpRanges.forEach(ipV4Range => {
          result.push({
            プロトコルとポート,
            ipアドレス: ipV4Range.CidrIp,
            説明文: ipV4Range.Description === undefined ? "" : ipV4Range.Description
          });
        });
        data.Ipv6Ranges.forEach(ipV6Range => {
          result.push({
            プロトコルとポート,
            ipアドレス: ipV6Range.CidrIpv6,
            説明文: ipV6Range.Description === undefined ? "" : ipV6Range.Description
          });
        });
      });
      if (result.length == 0) { return; }
      // resultの中身をフォーマットして表示する
      const プロトコルとポートの最長文字数 = result.map(a => a.プロトコルとポート.length).sort((a, b) => b - a)[0];
      const ipアドレスの最長文字数 = result.map(a => a.ipアドレス.length).sort((a, b) => b - a)[0];
      result.forEach(r => {
        let v = `    `;
        v += r.プロトコルとポート;
        v += " ".repeat(プロトコルとポートの最長文字数 - r.プロトコルとポート.length + 1);
        v += r.ipアドレス;
        v += " ".repeat(ipアドレスの最長文字数 - r.ipアドレス.length + 1);
        v += r.説明文;
        console.log(v);
      });
      return result;
    };
    console.log(`  受信許可`);
    許可設定解析(config.IpPermissions)
    //console.log(`送信許可`);
    //許可設定解析(config.IpPermissionsEgress)
  });
}
async function runInstance(ami, subnet, instanceType, keyName, volumeSize) {
  const apiResult = await new Promise((resolve, reject) => {
    awsSdkEc2.runInstances({
      ImageId: ami,
      SubnetId: subnet,
      InstanceType: instanceType,
      KeyName: keyName,
      MaxCount: 1,
      MinCount: 1,
      TagSpecifications: [
        {
          ResourceType: "instance", Tags: [
            { Key: "Name", Value: "cliより" }
          ]
        }
      ]
    }, (err, result) => {
      if (err) {
        reject(err);
      } else {
        resolve(result);
      }
    });
  });
  const instanceId = apiResult.Instances[0].InstanceId;
  console.log(`instanceId = ${instanceId}`);
  //console.log(apiResult.Instances[0]);
  let webUiから作ったインスタンス;
  let 今作ったインスタンス;
  while (true) {
    const instanceList = await new Promise((resolve, reject) => {
      awsSdkEc2.describeInstances((error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      });
    });
    const webUiから作ったインスタンスt = instanceList.Reservations.find(a => a.Instances.find(b => b.InstanceId == "i-") != null).Instances[0];
    const 今作ったインスタンスt = instanceList.Reservations.find(a => a.Instances.find(b => b.InstanceId == instanceId) != null).Instances[0];
    if (今作ったインスタンスt.State.Code == 0) {
      await new Promise(ok => { setTimeout(() => { ok(); }, 1000) });
      continue;
    } else {
      webUiから作ったインスタンス = webUiから作ったインスタンスt;
      今作ったインスタンス = 今作ったインスタンスt;
      break;
    }
  }
  const insA = JSON.stringify(webUiから作ったインスタンス, null, "  ");
  const insB = JSON.stringify(今作ったインスタンス, null, "  ");
  console.log(instanceList.Reservations);

}
(async () => {
  const ec2Config = {
    ami: "ami-28ddc154",
    instance: "t2.micro",
    storageGb: 20
  };
  {
    const r = cp(`aws sts get-caller-identity`);
    console.log(`YourAccount`);
    console.log(`  UserId :${cs.bold + cs.cyan}${JSON.parse(r).UserId}${cs.reset}`);
    console.log(`  Account:${cs.bold + cs.cyan}${JSON.parse(r).Account}${cs.reset}`);
    console.log(`  Arn    :${cs.bold + cs.cyan}${JSON.parse(r).Arn}${cs.reset}`);
  }
  console.log(`EC2のキーペアを選択して下さい`);
  const keyPairId = await getEc2KeyPairs();
  console.log(`EC2のサブネットIDを選択して下さい`);
  const { subnetId, vpcId } = await getSubnetIdAndVpcId();

  // セキュリティグループはwebUIから指定した方が良いのでナシ
  //console.log(`EC2のセキュリティグループIDを選択して下さい`);
  //const aaa = await getSecurityGroup(`vpc-2f7a2e4a`);

  await runInstance(ec2Config.ami, subnetId, ec2Config.instance, keyPairId, ec2Config.storageGb);

  {
    //const r = cp(`aws ec2 describe-instances`);
    //console.log(r);
  }
})();

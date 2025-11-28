'use strict';

(() => {

const lang = (() => {
	var languageString = navigator.language || navigator.userLanguage || '';
	return languageString.split(/[_-]/)[0].toLowerCase();
})();

const lang_ru = (lang == 'ru');

const Connection = __ble_mx_api.ConnectionExt;

const str2Uint8Array = __ble_mx_api.str2Uint8Array;
const DataView2str   = __ble_mx_api.DataView2str;
const str_csum       = __ble_mx_api.str_csum;
const CSUM_LEN       = __ble_mx_api.CSUM_LEN;
const COMPRESS_TAG   = __ble_mx_api.COMPRESS_TAG;
const decompress     = __ble_mx_api.decompress;

const status = document.getElementById('status');
const bt_btn = document.getElementById('bt-btn');
const cmd_arg = [
	document.getElementById('cmd-arg1'),
	document.getElementById('cmd-arg2'),
	document.getElementById('cmd-arg3')
]
const txt_res   = document.getElementById('txt-res');
const sel_cmd   = document.getElementById('select-cmd');
const sel_log   = document.getElementById('select-log');
const cmd_empty = document.getElementById('opt-select-cmd-empty');
const log_empty = document.getElementById('opt-select-log-empty');
const qrcode_el = document.getElementById('qrcode');
const qrcode_o  = new QRCode(qrcode_el, {
	colorDark  : "#000000",
	colorLight : "#ffffff",
	correctLevel : QRCode.CorrectLevel.H
});

const ncmd_args = cmd_arg.length;

let bt_conn = null;

const commands = {
	'key_admin' : {
		name : !lang_ru ? 'Get administrator access key' : 'Получить ключ доступа администратора'
	},
	'key_mgr' : {
		name : !lang_ru ? 'Get manager access key' : 'Получить ключ доступа мэнеджера'
	},
	'uptime' : {
		name : !lang_ru ? 'Running time' : 'Время работы'
	},
	'reboot' : {
		name : !lang_ru ? 'Reboot' : 'Перезагрузить',
	},
	'shutdown' : {
		name : !lang_ru ? 'Shutdown' : 'Выключить'
	},
	'log_tail' : {
		name : !lang_ru ? 'Show log' : 'Показать лог',
		// The first argument is the log filename.
		// It should be selected from the drop down list.
		args : !lang_ru ? ['[number of lines]'] : ['[количество строк]']
	},
	'syslog_tail' : {
		name : !lang_ru ? 'Show system log' : 'Показать системный лог',
		args : !lang_ru ? ['[number of lines]'] : ['[количество строк]']
	},
	'top' : {
		name : !lang_ru ? 'Top processes' : 'Детализация загрузки',
		args : !lang_ru ? ['[the number of process]', '[more top options]'] : ['[количество процессов]', '[доп. опции]']
	},
	'wifi' : {
		name : !lang_ru ? 'Connect / forget WiFi' : 'Подключить / забыть WiFi',
		args : !lang_ru ? [
			'network name | leave empty to forget',
			'network password | leave empty to forget'
		]  : [
			'имя сети | оставить пустым, чтобы забыть',
			'пароль сети | оставить пустым, чтобы забыть'
		]
	},
	'ifconfig' : {
		name : !lang_ru ? 'Network configuration' : 'Конфигурация сети'
	},
	'timedatectl' : {
		name : !lang_ru ? 'System time / date control' : 'Системное время / дата',
		args : !lang_ru ? ['[request]', '[argument]'] : ['[запрос]', '[параметр]']
	},
	'update' : {
		name : !lang_ru ? 'Update from the cloud' : 'Обновление из облака',
	},
	'mk_passwd' : {
		name : !lang_ru ? 'Create new password' : 'Создать новый пароль',
	},
	'ssh_dis' : {
		name : !lang_ru ? 'Disable remote access' : 'Отключить удаленный доступ',
	},
	'ssh_en' : {
		name : !lang_ru ? 'Enable remote access' : 'Включить удаленный доступ',
	},
};

// Text translations
const tr =
!lang_ru ? {
	unsupported     : 'The Bluetooth is not supported in this browser. Please try another one.',
	connect         : 'Connect',
	execute         : 'Execute',
	not_connected   : 'not connected',
	connected       : 'connected',
	reconnecting    : 'reconnecting ..',
	connecting      : 'connecting ..',
	empty_cmd       : '--command--',
	empty_log       : '--log file--',
	argument        : 'argument',
	results         : 'results area, press Enter to copy',
	waiting_results : 'waiting results',
	done            : 'done',
	failed          : 'failed',
} : {
	unsupported     : 'Bluetooth не поддерживается браузером, попробуйте другой.',
	connect         : 'Подключиться',
	execute         : 'Выполнить',
	not_connected   : 'не подключено',
	connected       : 'подключено',
	reconnecting    : 'переподключение ..',
	connecting      : 'подключение ..',
	empty_cmd       : '--команда--',
	empty_log       : '--файл лога--',
	argument        : 'параметр',
	results         : 'область вывода результатов, нажмите Enter, чтобы скопировать',
	waiting_results : 'ожидаем результаты',
	done            : 'выполнено',
	failed          : 'ошибка',
};

// The list of commands / logs received from scanner
let cmd_list;
let log_list;

function on_arg_keypress(e)
{
	if (e.keyCode == 13)
		bt_btn.click();
}

function on_txt_res_keypress(e)
{
	navigator.clipboard.writeText(txt_res.textContent).then(function() {
			console.log('result text copied to clipboard');
		}, function(err) {
			console.error('copy to clipboard failed:', err);
		});
}

function initPage()
{
	if (!navigator.bluetooth) {
		document.body.innerHTML = '<div class="alert-page">' + tr.unsupported + '</div>';
		return;
	}
	status.textContent = tr.not_connected;
	cmd_empty.textContent = tr.empty_cmd;
	bt_btn.textContent = tr.connect;
	bt_btn.onclick = onBtn;
	bt_conn = new Connection(rx_cb, true);
	sel_cmd.addEventListener('change', on_cmd_selected);
	sel_log.addEventListener('change', on_log_selected);
	for (let i = 0; i < ncmd_args; ++i) {
		cmd_arg[i].addEventListener('keypress', on_arg_keypress);
		cmd_arg[i].placeholder = tr.argument + ' #' + (i+1);
	}
	if (navigator.clipboard)
		txt_res.addEventListener('keypress', on_txt_res_keypress);
}

function onBTConnected(device)
{
	bt_btn.textContent = tr.execute;
	if (!cmd_list)
		send_cmd('_ls_cmd');
	else if (!log_list)
		send_cmd('_ls_log');
	else
		init_cmd_selector();
}

function doSendCmd()
{
	const cmd = sel_cmd.value;
	if (!cmd) {
		console.error('command not selected');
		return;
	}
	const descr = commands[cmd];
	if ('args' in descr)
	{
		let args = [];
		const nargs = descr['args'].length;
		let valid_args = 0;
		if (cmd == 'log_tail') {
			if (!sel_log.selectedIndex) {
				console.error('log file not selected');
				return;
			}
			args.push(sel_log.value);
			valid_args = 1;
		}
		for (let i = 0; i < nargs; ++i) {
			const arg = cmd_arg[i].value;
			args.push(arg);
			if (arg)
				valid_args = args.length;
		}
		send_cmd(cmd, args.slice(0, valid_args));
	} else
		send_cmd(cmd);

	txt_res.textContent = '';
	txt_res.placeholder = tr.waiting_results;
	txt_res.disabled = true;
}

function onBTDisconnected(device)
{
	status.textContent = tr.reconnecting;
	status.classList.add('failed');
	status.classList.remove('connected');
	bt_btn.disabled = true;
	sel_cmd.disabled = true;
	sel_log.disabled = true;
	for (let i = 0; i < ncmd_args; ++i)
		cmd_arg[i].disabled = true;
	txt_res.disabled = true;
	txt_res.placeholder = '';
	connectTo(device);
}

function cmd_ok()
{
	return sel_cmd.selectedIndex != 0 && (sel_cmd.value != 'log_tail' || sel_log.selectedIndex != 0);
}

function init_cmd_selector()
{
	const cmd = sel_cmd.value;
	const descr = commands[cmd];
	const nargs = descr && 'args' in descr ? descr['args'].length : 0;
	for (let i = 0; i < nargs; ++i)
		cmd_arg[i].disabled = false;
	sel_cmd.disabled = false;
	sel_log.disabled = (cmd != 'log_tail');
	if (txt_res.textContent)
		txt_res.disabled = false;
	bt_btn.disabled = !cmd_ok();
	status.textContent = tr.connected;
	status.classList.remove('failed');
	status.classList.add('connected');
	if (navigator.clipboard)
		txt_res.placeholder = tr.results;
}

function on_cmd_selected()
{
	const cmd = sel_cmd.value;
	const descr = commands[cmd];
	const nargs = descr && 'args' in descr ? descr['args'].length : 0;
	for (let i = 0; i < nargs; ++i) {
		cmd_arg[i].placeholder = descr['args'][i];
		cmd_arg[i].value = '';
		cmd_arg[i].disabled = false;
	}
	for (let i = nargs; i < ncmd_args; ++i) {
		cmd_arg[i].placeholder = '';
		cmd_arg[i].value = '';
		cmd_arg[i].disabled = true;
	}
	if (cmd == 'log_tail') {
		log_empty.textContent = tr.empty_log;
		sel_log.disabled = false;
	} else {
		log_empty.textContent = '';
		sel_log.disabled = true;
	}
	sel_log.selectedIndex = 0;
	bt_btn.disabled = !cmd_ok();
}

function on_log_selected()
{
	bt_btn.disabled = !cmd_ok();
}

function setup_commands(arr)
{
	console.log('commands:', arr);
	for (const cmd in commands) {
		if (!arr.includes(cmd)) {
			console.log('unsupported command:', cmd);
			delete commands[cmd];
		}
	}
	for (const cmd of arr) {
		if (!cmd || cmd[0] == '_')
			continue;
		if (!(cmd in commands)) {
			console.log('unknown command added:', cmd);
			commands[cmd] = {'name' : cmd, 'args' : Array(ncmd_args).fill('')};
		}
	}
	for (const cmd in commands) {
		var opt = document.createElement('option');
		opt.value = cmd;
		opt.innerHTML = commands[cmd].name;
		sel_cmd.appendChild(opt);		
	}
	cmd_list = arr;
}

function setup_logs(arr)
{
	console.log('logs:', arr);
	for (const f of arr) {
		if (f) {
			var opt = document.createElement('option');
			opt.value = f;
			opt.innerHTML = f;
			sel_log.appendChild(opt);
		}
	}
	log_list = arr;
}

function handle_cmd_list(o)
{
	if (o['ret'] !== 0) {
		console.warn('unexpected _ls_cmd return code');
		return;
	}
	if (!cmd_list)
		setup_commands(o['out'].split('\n'));
	if (!log_list)
		send_cmd('_ls_log');
}

function handle_log_list(o)
{
	if (o['ret'] !== 0) {
		console.warn('unexpected _ls_log return code');
		return;
	}
	if (!log_list) {
		setup_logs(o['out'].split('\n'));
		if (bt_conn.is_connected())
			init_cmd_selector();
	}
}

function handle_cmd_resp(o)
{
	const out = o['out'];
	const ret = o['ret'];
	var resp = out;
	const qrcode_prefix = 'qrcode=';
	if (!ret && out.startsWith(qrcode_prefix) && out.length > qrcode_prefix.length) {
		qrcode_o.clear();
		qrcode_o.makeCode(out.slice(qrcode_prefix.length));
		qrcode_el.classList.remove('hidden');
		// resp = '';
	} else {
		qrcode_el.classList.add('hidden');
	}
	if (resp) {
		txt_res.textContent = resp;
		txt_res.classList.remove('empty-response');
	} else
		txt_res.classList.add('empty-response');
	txt_res.placeholder = '';
	if (ret) {
		txt_res.classList.add('failed');
		if (!resp)
			txt_res.textContent = tr.failed;
	} else {
		txt_res.classList.remove('failed');
		if (!resp)
			txt_res.textContent = tr.done;
	}
	txt_res.disabled = false;
}

function send_cmd(cmd, args=[])
{
	let o = {'cmd' : cmd};
	if (args.length)
		o['args'] = args;
	let str = 'C' + JSON.stringify(o).slice(1, -1);
	str += str_csum(str);
	console.log('tx:', str);
	bt_conn.write(str2Uint8Array(str));
	if (cmd[0] == '_')
		status.textContent += '.';
}

function do_receive(data)
{
	let str = DataView2str(data);
	console.debug('rx:', str);
	if (str.slice(-CSUM_LEN) != str_csum(str, str.length - CSUM_LEN)) {
		console.error('bad csum:', str);
		return;
	}
	if (str[0] != 'C') {
		console.warn('unexpected message type');
		return;
	}
	const o = JSON.parse('{' + str.slice(1, -CSUM_LEN) + '}');
	const cmd = o['cmd'];
	switch (cmd) {
	case '_ls_cmd':
		handle_cmd_list(o);
		break;
	case '_ls_log':
		handle_log_list(o);
		break;
	default:
		handle_cmd_resp(o);
		break;
	}
}

function rx_cb(data)
{
	const len = data.byteLength;
	if (data.getUint8(len - 1) != COMPRESS_TAG) {
		do_receive(data);
		return;
	}
	decompress(new DataView(data.buffer, 0, len - 1)).then(d => {
		console.log('unzip:', len - 1, '->', d.byteLength);
		do_receive(d);
	})
	.catch((err) => {console.error('failed to decompress', err);});
}

function connectTo(device)
{
	bt_conn.connect(device, onBTConnected, onBTDisconnected);
}

function doConnect()
{
	console.log('doConnect');
	status.textContent = tr.connecting;
	bt_btn.disabled = true;
	return navigator.bluetooth.requestDevice({
		filters: [{services: [Connection.bt_svc_id]}],
	}).
	then((device) => {
		console.log(device.name, 'selected');
		connectTo(device);
	})
	.catch((err) => {
		console.error('Failed to discover BT devices');
		status.textContent = tr.not_connected;
		bt_btn.textContent = tr.connect;
		bt_btn.disabled = false;
	});
}

function onBtn(event)
{
	if (bt_conn.is_connected())
		doSendCmd();
	else
		doConnect();
}

initPage();

})();

